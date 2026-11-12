> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 03-api-platform — refactoring review

Scope: `src/renderer/api/` platform services (boards, board-*, board-settings/, board-vars/, published-boards,
capabilities + capability-bus + transport + channel, module-service(-status), site-extension*, library/autoload,
app-service-registry, mcp-handler + mcp/, internal/, tools/, setup/, ts-project-*, global-mute, window-recording,
window-screen, mneme-*, proxy-tunnel, archive-service, downloads, terminal, shell/).

## Summary

The individual classes are mostly readable, and some newer pieces are well shaped (`BoardNavigationReturnService`,
`TsProjectRegistry`, `Downloads`, the `tools/` split). The platform layer as a whole, though, has no owner for its
central concepts. "A board" (identity, trusted-or-bundled access, inventory, lifecycle) is rebuilt independently by
`boards.ts`, `custom-editor-registry.ts`, `board-namespace.ts`, `board-service-settings.ts`, the guide mounts and main's
`board-trust-service.ts`. The renderer also throws away fields main already computed and derives them again. Seven call
sites each do their own version of "untrust/delete a board", and their side effects differ. Much of the board domain
model lives in `editors/board/`. As a result `api/` imports `editors/`, `ui/`, `scripting/` and `automation/` about 45
times, which contradicts the documented dependency rules.

The three biggest problems:
1. **Board identity, inventory and lifecycle have no owner** (PLAT-1, PLAT-2). The same rules are re-derived in
   5+ places, and one copy has already drifted (`board-trust.ts:144` vs `shared/board-manifest-utils.ts:139`).
2. **There are two live capability invocation pipelines** (PLAT-4). Every internal app caller uses the renderer
   "legacy" bus, which re-implements the deadline, size, cycle and outstanding limits that main's router already
   enforces.
3. **Startup, mirroring and IPC have no single pattern** (PLAT-5, PLAT-6, PLAT-7):
   - Service start-up is spread over 8 places.
   - Main-owned state is mirrored 6 different ways.
   - Main→renderer requests use 3 hand-rolled RPC protocols, one of them the "MCP" channel carrying board-bridge
     traffic.

## Findings

### PLAT-1: Board identity, access and inventory are re-derived in many places, in the renderer and again in main
- **Priority:** P1
- **Effort:** L
- **Where:**
  - inventory merges: `src/renderer/api/boards.ts:104-201`, `src/renderer/editors/board/custom-editor-registry.ts:461-480`, `src/renderer/guides/board-guide-mounts.ts:44`
  - "trusted or bundled": `src/renderer/editors/board/board-access.ts:7-15` vs re-implementations at `src/renderer/api/boards.ts:88-102` and `src/renderer/api/board-service-settings.ts:25-33`
  - bundled discovery twice: `src/renderer/editors/board/bundled-board-registry.ts:42-60` and `src/main/board-trust-service.ts:533-545`
  - disabled-bundled filtering twice: renderer `bundled-board-registry.ts:73-78` (reads the setting) plus `src/renderer/api/board-trust-sync.ts:18-28` pushing it to main, which filters again at `board-trust-service.ts:452`
  - identity rule four times: `src/renderer/editors/board/board-manifest.ts:264-282` (`hasStableBoardIdentity` + `stableBoardIdentity`), `src/renderer/api/board-settings/board-settings-bridge.ts:45-53` (`missingIdentityFields`), `src/renderer/api/board-namespace.ts:25-41`, `src/main/board-trust-service.ts:467-471` (`callerId`, which differs for local boards: `local:<sha>` vs root path)
  - permission predicate three times: `src/shared/board-manifest-utils.ts:138-142`, `src/main/board-trust-service.ts:332-341`, `src/renderer/api/board-trust.ts:138-148`
  - `manifestChanged` received and then discarded: `src/ipc/main/board-handlers.ts:135-149` sends `manifestChanged`, `callerId`, `boardName`, `service`; `src/renderer/api/board-trust.ts:111-136,173-174` keeps only 4 of the fields and recomputes `manifestChanged` with `JSON.stringify`
- **Problem:** There is no renderer object that answers "what boards exist, where did each come from, what is its
  identity, what is it granted?". `BoardTrust` holds five parallel `Map`s keyed by normalized root
  (`board-trust.ts:76-80`). It rebuilds them with N+1 IPC calls per trust change (one `getBoardFileAccessGrants` per
  board, `:117-119`) and diffs them with `JSON.stringify` across five maps (`:121-127`). Every consumer then layers its
  own merge on top:
  - `boards.ts` merges trust paths, install entries and open pages.
  - `custom-editor-registry` merges trusted, bundled and installed-untrusted boards and re-reads every manifest from
    disk.
  - the guide mounts merge trusted and bundled boards.
  - `board-service-settings` re-implements `isBoardPermitted` with its own `fpNormalizeForCompare` loop.

  Main already builds the authoritative snapshot (`board-trust-service.ts:451-495`: trusted + enabled bundled
  sources, grants, `manifestChanged`, `callerId`, compatibility). The renderer discards most of it and derives it
  again. The copies have started to drift. The renderer legacy branch is `flag !== "service" || grant.service`
  (`board-trust.ts:144`). Shared and main also exclude `computerAudio` (`board-manifest-utils.ts:139`,
  `board-trust-service.ts:338`). The renderer copy has no `computerAudio` caller today, so this is a latent
  inconsistency rather than a live bug.
- **Refactor:**
  1. Move the pure manifest model (parse/normalize, identity, masks, `boardTrustDisclosure`) from
     `editors/board/board-manifest.ts` into `src/shared/board-manifest/` so main and renderer share one
     `boardIdentity(manifest, origin)` and one `boardPermissionAllows`. Delete the inline copies in
     `board-trust.ts:144-146`, `board-trust-service.ts:337-340` and `board-settings-bridge.ts:45-53`.
  2. Create `src/renderer/api/boards/BoardRegistry.ts`, a single reactive model with entries of shape
     `{ root, key, origin: "trusted"|"bundled"|"installed", bundledId?, identity, manifest (cached), grant,
     manifestChanged, uses, fileAccess, compatible }`. Feed it from one main snapshot instead of paths-broadcast plus
     N+1 pulls. Main should broadcast the full `TrustedBoardSnapshotEntry[]` (including file-access grants) on
     `eBoardTrustChanged`.
  3. Fold `board-access.ts`, `bundled-board-registry.ts` (renderer side) and `BoardTrust`'s maps into it. Expose
     `get(root)`, `isPermitted(root)`, `permissionOrigin(root)`, `list()`, `subscribe()`, and keep `trust()`/`untrust()`
     as thin IPC requests. Keep the "not exposed on `app`" invariant.
  4. Port the consumers (`boards.ts` listing, `custom-editor-registry.refresh`, guide mounts, `board-service-settings`,
     `board-namespace`) to read from the registry. Delete their merges.
- **Risk / notes:** This is the largest change in the area and touches trust, so keep the main-side authority and the
  "API requests, the user grants" invariant untouched. Do it after the shared manifest move. PLAT-2 and PLAT-10 become
  much smaller once this registry exists. The settings/vars namespace and main's `callerId` should become one function
  with an explicit origin parameter. Decide deliberately whether local boards keep root-path namespaces; changing that
  migrates stored settings.

### PLAT-2: Board lifecycle operations are composed by each caller, with inconsistent side effects
- **Priority:** P1
- **Effort:** M
- **Where:**
  - unregister: `src/renderer/api/boards.ts:349-357`
  - rename: `src/renderer/api/boards.ts:359-431`
  - uninstall: `src/renderer/api/board-install.ts:131-167`
  - remove: `src/renderer/editors/board/request-board-trust.ts:105-117`
  - unregister from Board Info: `src/renderer/editors/board-info/BoardInfoEditorModel.ts:578-587`
  - delete from the Boards panel: `src/renderer/editors/explorer/BoardsSecondaryView.ts:465-474`
  - remove from the tree: `src/renderer/ui/sidebar/EditorsTreeView.ts:250-259`
  - the open-page loop three times: `src/renderer/api/board-updates.ts:77-85` (`boardPagesForRoot`), `src/renderer/api/pages/PagesQueryModel.ts:63-72` (`findPagesByBoardRoot`), inline in `boards.ts:414-428`
- **Problem:** "Stop using a board" means up to six things:
  - stop the service
  - release its open pages (`ensureBoardIdle`)
  - untrust it
  - remove its category pins
  - invalidate its cached display text
  - drop its install-registry record

  Each surface picks its own subset:
  - `board-install.ts` does all six.
  - `BoardInfoEditorModel` does idle + untrust + unpin, but not the service stop or display-text invalidation.
  - `BoardsSecondaryView` deletes the folder, untrusts and unpins, without the idle check.
  - `EditorsTreeView` untrusts, unpins and toasts.
  - `request-board-trust.removeBoard` branches on the install registry itself.

  So `api/` has to import `ui/sidebar/pinned-items` (`boards.ts:355,384`, `board-install.ts:163`) and
  `ui/dialogs/*` to finish its own operations. The board-page query exists twice. The `board-updates.ts` copy uses
  `instanceof BoardEditorModel`, which forces a static import of the editor class into `api/` (`board-updates.ts:19`).
- **Refactor:**
  1. Add `src/renderer/api/boards/BoardLifecycle.ts`, one owner with `unregister(root)`, `delete(root)`,
     `uninstall(catalogId)`, `rename(root, newName)`, `installVersion(...)`, `ensureIdle(root, action)`. It sequences
     service stop → page release → disk change → trust → registry → display-text invalidation in one place.
     `uninstallCatalogBoard`, `ensureBoardIdle`, `runBoardVersionInstall` and the `renameBoard` body move here.
  2. Make pins react to trust instead of being cleaned by callers. `pinned-items` (ui) subscribes to
     `BoardRegistry`/`boardTrust` path removal and drops `board:<root>` membership. That removes every
     api→`ui/sidebar` import. Rename is the one case needing a carry-over: expose
     `BoardLifecycle.onRenamed(old, new)` and let pinned-items move the membership.
  3. Delete `boardPagesForRoot`. Use `pagesModel.query.findPagesByBoardRoot` (duck-typed, no editor import).
  4. Point all seven UI call sites and `app.boards` at `BoardLifecycle`. Confirmation dialogs stay in the UI callers,
     or are passed as a `confirm` callback, so the service does not import dialogs.
- **Risk / notes:** The behaviour changes deliberately: every path will now stop the service and invalidate display
  text. Folder deletion on Windows depends on releasing pages first (US-1407 comment at `board-updates.ts:129-133`), so
  keep that ordering. This depends on nothing else, but is cleaner after PLAT-1.

### PLAT-3: `api/` depends upward on `editors/`, `ui/`, `scripting/` and `automation/` (~45 imports), against the documented layering
- **Priority:** P2
- **Effort:** L (in slices of S/M)
- **Where:**
  - Dependency rule: `doc/architecture/overview.md:235,241` ("api/ … imports core/, uses IPC"; "Lower layers must NOT import from higher layers")
  - board domain in editors: `src/renderer/api/boards.ts:10-13,69,91,96,313,322-367,411,613`; `board-install-registry.ts:19`; `board-install.ts:13,20,247`; `board-namespace.ts:1-2`; `board-service-settings.ts:4-5`; `published-boards.ts:16-21`; `capability-bus.ts:15`
  - api constructing an editor: `src/renderer/api/boards.ts:578-590` duplicates `src/renderer/editors/board-info/open-board-info.ts:60-69` and needs `as unknown as EditorModel`
  - editor models used as file IO in api stores: `src/renderer/api/board-settings/BoardSettingsStore.ts:2-5,120-139`, `src/renderer/api/board-vars/BoardEnvStore.ts:2-5,74-85` (both `TextFileModel` from `editors/content-host`)
  - scripting in api: `src/renderer/api/mcp/board-call-command.ts:3-5,13` (`ScriptContext`, `resolveAiCall`, `BoardEditorModel`); `src/renderer/api/library-service.ts:4`; `src/renderer/api/autoload-service.ts:1`; `src/renderer/api/internal/GlobalEventService.ts:1,5`
  - automation in api: `src/renderer/api/window-screen.ts:23-52`
  - editor infra in api: `src/renderer/api/mneme-connection.ts:5-9` (`McpConnectionManager` from `editors/mcp-inspector`), `src/renderer/api/mneme-status.ts:6`, `src/renderer/api/capabilities.ts:21`
  - Monaco infrastructure under api: `src/renderer/api/setup/` (1,263 lines: `configure-monaco.ts`, `library-intellisense.ts`, six `monaco-languages/*`), `src/renderer/api/ts-project-registry.ts`, `src/renderer/api/ts-project-files.ts` (only consumers: `editors/shared/monaco-project-intellisense.ts`, `api/mcp/board-ts-project.ts`)
- **Problem:** `api/` is documented as the Object Model layer, but it is also home to editor infrastructure (Monaco
  setup, TS project IntelliSense), app-shell controllers (`internal/`), and the renderer half of the board bridge
  (`api/mcp/board-*`). Meanwhile domain code it needs lives in `editors/`: `board-manifest.ts` (1,044 lines),
  `bundled-board-registry`, `board-access`, `busy-boards`, `McpConnectionManager`, `mnemeTypes`. The result is cycles
  (`api/boards` → `editors/board/request-board-trust` → `api/board-trust`, `api/board-namespace`) and modules that
  cannot be understood without reading three layers.
- **Refactor (slices, each independent):**
  1. Board domain to shared/api: covered by PLAT-1 step 1. Also move `bundled-board-registry`, `board-access` and
     `busy-boards` into `api/boards/`, since they are pure state.
  2. `boards.installPublished` should call an extended `openBoardInfoPage({ catalogId, installDir })` that returns
     the model. Delete the hand-built `BoardInfoEditorModel` in `boards.ts:578-590`.
  3. Replace `TextFileModel` in both stores with a small `api/watched-json-file.ts`. It reads through `fs`, watches
     through `path-watch`, and optionally decrypts through `shell.encryption`. It needs no editor state.
  4. Move `api/setup/` and `ts-project-*.ts` to `src/renderer/editors/content-host/monaco/` (or `src/renderer/monaco/`).
     `App.initSetup` keeps a dynamic import.
  5. Move `McpConnectionManager` to `src/renderer/core/mcp/` or `src/shared/`. Move `mnemeTypes` parsing next to
     `mneme-status`.
  6. Move `window-screen.ts` to `automation/` (it is a facade over `automation/operations`). `api/window.ts` then
     reaches it lazily.
  7. Move `api/mcp/board-*.ts` out of `api/` (see PLAT-5) to wherever the board bridge host lives.
- **Risk / notes:** Mostly mechanical moves. Watch `execute_script` module identity: paths change, but singletons stay
  singletons because there is one module per path. Slice 4 must keep the Monaco NLS ordering in `renderer.ts`.

### PLAT-4: Two capability invocation pipelines are both live; the renderer re-implements limits main already enforces
- **Priority:** P1
- **Effort:** L
- **Where:**
  - legacy pipeline: `src/renderer/api/capabilities.ts:299-365` → `src/renderer/api/capability-bus.ts:197-348`
  - unified open dispatch: `src/renderer/api/capabilities.ts:258-290` (raw `window.electron.ipcRenderer`)
  - main limits: `src/main/capability-router.ts:67,240-251,341-353,433-444`
  - renderer re-implementation: `capability-bus.ts:62-162` (100-line structured-clone size estimator), `:220-269` (deadline/depth/outstanding)
  - validators run in both entry paths: `capabilities.ts:272-273` and `:315-316`
  - module-level state outside the class: `capabilities.ts:39-44`; `board-capability-transport.ts:26-27,82-84` alongside class fields `:120-121`
  - forwarding shims: `board-capability-transport.ts:52-58`, `:338-340`
  - transport injected though there is one implementation: `src/renderer/api/app-service-registry.ts:96-105`, `capability-bus.ts:193-195,425-428`
  - duplicate error normalizers: `capability-bus.ts:164-181` vs `board-capability-transport.ts:105-117`
  - internal callers on the legacy path (~20), e.g. `src/renderer/editors/browser/BrowserView.ts:799,805`, `src/renderer/editors/mermaid/MermaidEditor.ts:225`, `src/renderer/editors/settings/sections/ThemeSection.ts:275,286`, `src/renderer/content/builtin-schemes.ts:315`, `src/renderer/api/capability-feedback.ts:42`
- **Problem:** `doc/architecture/capabilities.md:216-237` calls `app.capabilities.invoke()` and the renderer bus
  "compatibility projections" and says "Do not use the legacy handler index … as the contract". Yet every Persephone
  caller uses exactly that path. A board `open` intent can therefore arrive in two ways:
  - the legacy path: `capabilityLegacyResolve`, then the renderer `CapabilityBus` (its own deadline timer, payload
    estimate, outstanding counter, cycle check), then `BoardCapabilityTransport`;
  - the unified path: the main `CapabilityRouter` (its own deadline, JSON size, outstanding counter, cycle check), then
    `eCapabilityOpen`, then `registerBoundOpenDispatch`, then the same `BoardCapabilityTransport` without the bus.

  The two outstanding counters are independent, so the per-handler cap of 32 is not a single cap. Cancellation is
  tracked in two maps (`capabilityBus.pending`, `registerBoundOpenDispatch`'s `active`). Platform payload validation is
  called from both paths. `capabilities.ts` mixes six jobs in one module:
  - the unified client
  - the legacy projection
  - the main index mirror (module variables)
  - the built-in handler table, seeded from `editorRegistry` at module load in `register-editors.ts:233`
  - the bound-open IPC server
  - the channel-port pickup, using a magic `capability:${requestId}` board id (see PLAT-5)
- **Refactor:**
  1. Route `Capabilities.invoke()` through the unified main path: `api.capabilityInvoke({ key, method: "open", ... })`,
     after `capabilityGet` with the legacy id/filter mapping. Keep only the result projection
     (`projectCapabilityOutcome`) for the legacy return shape.
  2. Delete `CapabilityBus` limit enforcement (`estimatePayloadSize`, deadline, outstanding, cycle). Keep
     `CapabilityError` in its own `api/capability-error.ts`. That also removes the reason for the
     `setTransport`/`registerCapabilityTransport` injection, which only breaks the import cycle with
     `board-capability-transport`.
  3. Split `capabilities.ts` into:
     - `capabilities/CapabilitiesClient.ts`: `app.capabilities` (`get`/`providers`/`invoke`/`list`/`handlers`), holding
       the index mirror as instance state;
     - `capabilities/builtin-open-handlers.ts`: the editor-backed handler table, built lazily on first dispatch
       instead of from `register-editors`;
     - `capabilities/open-dispatch-server.ts`: the `eCapabilityOpen` receiver, which validates once with a
       `PLATFORM_PAYLOAD_VALIDATORS` map keyed by id.
  4. Turn `BoardCapabilityTransport` into a class that owns all its state (frames, reservations, initial intents). Make
     `registerBoardCapabilityFrame`/`markReady`/`fail` its methods and drop the module-level maps and forwarding
     functions.
- **Risk / notes:** Board-side `persephone.capabilities.invoke()` keeps its `{ pageId, result }` shape through the
  projection. Verify `alwaysOpensNewPage`, `discardPage` and caller-page cancellation (`capability-bus.ts:303-308`)
  survive. Main must accept the renderer as a caller with page context. The Excalidraw bundled board uses
  `capabilities.invoke` (`assets/boards/excalidraw/index.html`), so it is a ready end-to-end check.

### PLAT-5: Main→renderer requests use three hand-rolled protocols; the "MCP" channel is really the board-bridge RPC
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/api/mcp-handler.ts:2,18-40`: `require("electron")` ipcRenderer with JSON-RPC envelope and codes `-32601`/`-32603`
  - `src/renderer/api/mcp/command-registry.ts:13-30`: method names `board_call`, `board_openRawLink`, `board_openBoard`, `board_*TsProject`; main side duplicates these strings in `src/main/board-bridge.ts:719,745,906,1043,1308`
  - board themes bridge hidden inside `board_call`: `src/renderer/api/mcp/board-call-command.ts:15-17,94-113`, using regex path parsing and a `app.themes as unknown as Record<string, (...)>` cast at `:105-106`
  - `src/renderer/api/board-service-settings.ts:35-87`: raw `window.electron.ipcRenderer.on` with its own `{requestId, ok, error}` reply channels
  - `src/renderer/api/capabilities.ts:258-290`: a third envelope, `BoundOpenSettlement`
  - other IPC styles in the area: `src/renderer/api/global-mute.ts:1` (`import { ipcRenderer } from "electron"`), `api.onXxx` callbacks, `rendererEvents[...]`
  - every board-bridge call is logged as an MCP request: `src/renderer/api/mcp-handler.ts:37` → `src/renderer/api/mcp/request-log.ts:10-38`
  - magic routing prefixes in `eBoardServiceChannel.boardId`: `capability:` (`capabilities.ts:199`, `src/main/audio-service.ts:287,361`, `src/main/module-service-supervisor.ts:811`), `board-frame:` with `.slice(12)` (same lines), `voice-typing:` (`module-service-supervisor.ts:73`, `src/renderer/ui/speech/SpeechTranscriptionProvider.ts:16`, `src/renderer/ui/transcript/TranscriptController.ts:73`)
  - MCP-shaped internal API kept after the single-`call` change: `src/renderer/api/mcp/tool-commands.ts:33-166` returns `McpResponse`, then `src/renderer/scripting/ai-vision/namespaces/tools.ts:67-70,175,215,243` unwraps it and re-projects (`projectTool`)
- **Problem:** The renderer is a request server for main in three places, each with its own envelope, error encoding,
  readiness handling and logging. The MCP channel carries board-bridge traffic. The board-bridge RPC's method names are
  bare strings on both sides with no shared type. The board `themes.*` API is not a `call` path at all but is
  special-cased inside `handleBoardCall`. A port's purpose is encoded by string-prefixing a field named `boardId`.
- **Refactor:**
  1. Add `src/ipc/renderer-rpc.ts`, one typed main→renderer RPC: `RendererRpcMethods` interface, `requestId`
     correlation, `{ ok, result } | { ok: false, error: { code, message } }`, and readiness queueing (move the
     `handlerReady` gate here). Main's `sendToRendererForWebContents` and the board-service-settings sender use it.
  2. Register board-bridge methods in their own module (`api/board-bridge/host-handlers.ts`, or under
     `editors/board/` after PLAT-3) with typed params: `boardCall`, `boardThemes` (its own method, not regex on
     `path`), `openRawLink`, `openBoard`, `registerTsProject`, `serviceSettings.get/subscribe/unsubscribe`. Keep the
     MCP `call` handler and its request log for `call` only.
  3. Replace the `boardId` prefixes with a discriminated `ServiceChannelTarget` union
     (`{ kind: "board-frame", boardId } | { kind: "capability", requestId } | { kind: "voice-typing", windowId }`) in
     `ipc/module-service-channels.ts`.
  4. Replace `tool-commands.ts` with plain typed functions in `api/tools/` (`searchTools(query, max)`,
     `refreshToolsets()`, `createToolset(name, dir)`). The ai-vision namespace calls them directly. Delete
     `unwrapResponse`.
  5. Route `global-mute.ts`, `capabilities.ts` and `board-service-settings.ts` through `api`/`rendererEvents`, or the
     new RPC, rather than raw `ipcRenderer`.
- **Risk / notes:** Main and renderer change together, but there is no external protocol. MCP `call` behaviour must not
  change. Check that the Mneme/MCP request log no longer shows board traffic; that is intended.

### PLAT-6: Platform service start-up is spread across eight places; app-service-registry covers only `app.*` keys
- **Priority:** P2
- **Effort:** M
- **Where:**
  1. `src/renderer.ts:24-27` (`initBoardTrustSync`, `customEditorRegistry.ensureInitialized`)
  2. `src/renderer/api/app-service-registry.ts:68-72,93-106` (only `downloads` and `capabilities` have `initialize`)
  3. `src/renderer/api/app.ts:133-136,151-167` (`ui-preferences`, `initModuleServiceStatus`, fire-and-forget `publishedBoards.load`, `boardInstallRegistry.load`, `registeredTools.ensureInitialized`)
  4. `app.ts:203-209` (`initBoardServiceSettings`, `initMcpHandler`)
  5. `app.ts:240-246,264-265,299-300` (`initSiteExtensionTrustSync`, `initBoardNavigationReturn`, `initBoardPipeHandler`, `initMcpHandler` again + `markMcpHandlerReady`)
  6. `app.ts:303-357,362-394` (settings→main pushes; delayed `mnemeStatusModel.init`, `mnemeConnection.init`, `autoloadService.loadScripts`)
  7. constructor side effects: `src/renderer/api/capability-bus.ts:188-191`, `src/renderer/api/board-vars/BoardEnvStore.ts:39-47`, `src/renderer/api/library-service.ts:44-53`, `src/renderer/api/tools/registered-tools.ts` (constructor subscribes to `toolsTrust`), `src/renderer/editors/register-editors.ts:233` (`seedPlatformCapabilities` at module load)
  8. lazy first-use: `src/renderer/api/module-service.ts:105-117`, `src/renderer/api/published-boards.ts:71-82`, `src/renderer/api/setup/library-intellisense.ts:17-31`
  - settings→main sync in two places: `src/renderer/api/board-trust-sync.ts:18-28` and `app.ts:305-307,362-393`
  - `dispose()` defined but never called: `module-service.ts:562`, `autoload-service.ts:10`, `library-service.ts:70`, `registered-tools.ts` `dispose`
- **Problem:** To know when a platform service is live, or in which order trust, capabilities and the MCP handler start,
  you have to read `renderer.ts`, three `App` methods, the descriptor table and several constructors. The descriptor
  table was introduced to stop special-casing services in `App` (overview.md:125-129), but most internal services
  bypass it. Each `init*` function invents its own `initialized` flag (`board-trust-sync.ts:8`,
  `site-extension-trust-sync.ts:5`, `board-service-settings.ts:10`, `mcp-handler.ts:12`, `capabilities.ts:44`).
- **Refactor:**
  1. Add `src/renderer/api/platform-startup.ts`: an ordered table of internal start-up entries
     `{ name, phase: "services" | "before-pages" | "events" | "deferred", start(): Promise<void> | void }`. `App` walks it
     per phase with the same failure reporting as `_loadServices`. Move every list item above into it, with a one-line
     comment for each ordering constraint (for example, "MCP handler before pages: restored boards call the bridge").
  2. Replace `board-trust-sync`'s settings push and the `initEvents` settings block with one `settings-main-sync.ts`
     table `{ key → (value) => api.setX(value) }`, run once at start and on `settings.onChanged`.
  3. Remove constructor side effects. Give `CapabilityBus` (if it survives PLAT-4), `BoardEnvStore`,
     `LibraryService` and `RegisteredTools` an explicit `start()` called from the table.
  4. Delete the never-called `dispose()` methods, or call them from a single `windowClosing` teardown entry. Pick one.
- **Risk / notes:** Order-sensitive. Copy the current order exactly first, then simplify. PLAT-7's mirror base class
  removes most of the `-sync.ts` modules.

### PLAT-7: Main-owned state is mirrored six different ways; each mirror invents its own stale-snapshot guard
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/api/board-trust.ts:84-99,241-259` (`pathsRevision`) + separate sync module `src/renderer/api/board-trust-sync.ts`
  - `src/renderer/api/site-extension-trust.ts:16-34` (`revision`) + separate sync module `src/renderer/api/site-extension-trust-sync.ts`
  - `src/renderer/api/published-boards.ts:71-91` (subscribes inside `load()`)
  - `src/renderer/api/module-service-status.ts:9-57` (module-level maps, `statusEventRevisions`; no subscribe API)
  - `src/renderer/api/capabilities.ts:39-63` (module variables, `latestRevision`)
  - `src/renderer/api/downloads.ts:19-40` (`TModel` + `own()`, the clean one)
  - consumers reaching around the mirror: `src/renderer/editors/board-info/BoardInfoEditorModel.ts:229-240` subscribes to raw `eBoardTrustChanged` and raw `eModuleServiceStatusChanged`, then reads `moduleServiceStatus`, relying on that module having subscribed first; `src/renderer/api/module-service.ts:110` subscribes to the same status event separately
  - third trust store: `src/renderer/api/tools/tools-trust.ts:7-15,38-46,70-90` is renderer-owned (`trustedTools.txt` via `fs`), not synchronized across windows, and its header still says it is "structured after `board-trust.ts` … `fs` data-file helpers", which board trust stopped being in US-1538
- **Problem:** Each mirror solves the same problem: pull a snapshot from main, accept broadcasts, and never let a slow
  pull overwrite a newer broadcast. Each solves it with different code, fields and subscription ownership. Where a
  mirror has no change notification (`moduleServiceStatus`), callers go to raw IPC. That answers the "trust implemented
  twice?" question. Board and site-extension trust do not share rules (their domains differ), but they duplicate the
  mirror scaffolding: class + `TGlobalState` + `load()` + revision + `applyAuthoritative*` + a 12-line `-sync.ts`
  module. Agent-tool trust is a third, divergent model.
- **Refactor:**
  1. Add `src/renderer/core/state/MainSnapshotMirror.ts` (or `api/main-mirror.ts`): an abstract class with
     `fetch(): Promise<T>`, `event: RendererEventObject<T>`, `load()`, `get()`, `subscribe()`, a monotonically
     guarded `apply(snapshot)`, and ownership of its broadcast subscription (started by `load()` or the PLAT-6 table).
  2. Port `BoardTrust` (or `BoardRegistry` from PLAT-1), `SiteExtensionTrust`, `PublishedBoards`,
     `ModuleServiceStatus` (gaining `subscribe(root, listener)`) and the capability index to it. Delete both `-sync.ts`
     modules.
  3. Change `BoardInfoEditorModel` to subscribe through the mirrors only.
  4. Move tools trust to main (`trustedTools.json` with a broadcast, like site extensions), or at least fix its header
     and add a cross-window broadcast. Either way it uses the same mirror.
- **Risk / notes:** Moving tools trust to main changes the persistence file, so migrate `trustedTools.txt` once in
  main. Without the move, a toolset registered in one window stays invisible to another window's `registeredTools`
  until its next `load()`.

### PLAT-8: Site-extension trust status is re-derived at about nine call sites; validation is duplicated between main and the renderer
- **Priority:** P2
- **Effort:** S–M
- **Where:**
  - grant-matches-manifest rule: `src/renderer/editors/browser/BrowserWebviewModel.ts:617,641,698,720,809,1103`; `src/renderer/editors/browser/BrowserEditor.ts:119`; `src/renderer/editors/tools-hub/SiteExtensionsTab.ts:185`; `src/renderer/api/site-extensions-agent.ts:73-76`
  - id/host validation: `src/main/site-extension-trust-service.ts:10-18` (`ID_PATTERN`, `validHost`) vs `src/renderer/api/site-extensions.ts:7,48-66` (`EXTENSION_ID_PATTERN`, `isExactSiteExtensionHost`); fetch hosts are already shared (`src/shared/site-extension-hosts.ts`)
  - `create()` re-validates instead of reusing `validateManifest`: `src/renderer/api/site-extensions-agent.ts:82-116` vs `src/renderer/api/site-extensions.ts:81-108`
  - host-claim map built twice: `site-extensions-agent.ts:108-116` vs `site-extensions.ts:230-250`
  - `isObject` duplicated: `site-extensions.ts:40`, `site-extensions-agent.ts:50`
- **Problem:** `SiteExtensionTrust` exposes raw grants, and every caller recomputes
  `grant && sameHostSet(grant.hosts, ext.hosts) && sameHostSet(grant.fetchHosts, ext.fetchHosts) [&& grant.enabled]`.
  The agent listing derives `trustState` and `hostsChangedSinceTrust` its own way. Only main enforces the id and host
  rules, but they are written twice.
- **Refactor:**
  1. Add `siteExtensionTrust.statusOf(extension: { id, hosts, fetchHosts }):
     "untrusted" | "trusted" | "disabled" | "hosts-changed"` (and `isRunnable(ext)`). Replace all nine sites. Make
     `sameSiteExtensionHostSet` private.
  2. Move `isValidSiteExtensionId`, `isExactSiteExtensionHost` and `validateSiteExtensionHosts` into
     `shared/site-extension-hosts.ts` (renamed `shared/site-extension-manifest.ts`). Use them in main's
     `parseTrustFile`/`validateInput`.
  3. In `create()`, build the manifest object and run it through the store's `validateManifest`. Ask the store for
     `claimedHosts()` instead of rebuilding the owner map.
- **Risk / notes:** Low. BrowserWebviewModel belongs to another reviewer, but the change there is replacing a boolean
  expression with a call.

### PLAT-9: `module-service.ts` is a procedural lease client with repeated subscription logic and a misleading name
- **Priority:** P2
- **Effort:** M
- **Where:**
  - state struct + module maps: `src/renderer/api/module-service.ts:21-70`
  - ~15 free functions over the struct: `:72-560`
  - subscribe-then-maybe-unsubscribe written four times: `:409-428`, `:431-447`, `:466-483`, `:516-529`; disposers twice: `:485-498`, `:531-542`
  - near-duplicate predicates: `:395-407`
  - second subscription to the status event: `:110` (also `module-service-status.ts:54`)
  - only consumer: `src/renderer/content/providers/ProxyProvider.ts:118,150,202,270,303`
- **Problem:** The module is the renderer side of the board content-provider lease, used only by `ProxyProvider`, but
  it is called `moduleService`. That suggests the general board-service API (`app.boards.requestService`), which goes
  through main instead. All per-board state (`ServiceLeaseClient`) is a plain object mutated by free functions
  (`loseLease`, `receivePort`, `handleMessage`, `dropPending`, …). The "send subscribe; if the intent vanished meanwhile
  and the subscribe was acknowledged, send unsubscribe; else mark acknowledged" protocol is copied for watch and status
  intents, both on first subscribe and on replay.
- **Refactor:** Rename to `board-provider-lease.ts` (optionally colocated in `content/providers/`). Make
  `BoardProviderLease` a class per board root, owning port, generation, pending requests, capabilities and intents,
  with methods `request`, `subscribe(kind: "watch" | "status", request, callback)`, `providerWritable`,
  `rangeReadable`, `activeContentReads`, `lose(code)`. Put a `ProviderSubscription` helper behind both intent kinds
  (`sendSubscribe`, `replay`, `dispose`). A `BoardProviderLeases` map class owns the single port subscription. Status
  changes come from `ModuleServiceStatus.subscribe` (PLAT-7) rather than a second raw IPC subscription.
- **Risk / notes:** This is the provider data path (ranged reads, watches), so keep message semantics byte-for-byte.
  Manual check: open a provider-backed page, restart the service, confirm the watch replays.

### PLAT-10: `boards.ts` (`app.boards`) mixes the facade with caching, configuration and duplicated helpers
- **Priority:** P2
- **Effort:** S (after PLAT-1/2: XS)
- **Where:**
  - same modules imported statically and again dynamically: `src/renderer/api/boards.ts:15-19` vs `:75-76,353,381,386,450-452,491-492,511,539,570,610,622-627`; `api` `:19` vs `:84`; file-path `:11` vs `:83,371,614`; `readBoardManifest` `:12` vs `:613`; `createLinkData` `:23` vs `:413`
  - ad-hoc fallback caches: `:119-158` (`cachedTrustPaths`, `cachedInstalledEntries`) plus helpers that exist only for them: `board-trust.ts:205-212` (`readPaths`), `board-install-registry.ts:140-148` (`readInstalled`)
  - `isBoardFolder` + error repeated: `:91-94,322-325,341-344,360-363`
  - global `.app` call-timeout knob: `:30-42,291-303`, used by browser pages too (`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:321-325`)
- **Problem:** The header comment says editor-adjacent modules are dynamically imported "so the core api bundle stays
  decoupled", but the same modules are already static imports, so the dynamic imports only add noise. The fallback
  caches cover a "not loaded yet" window that bootstrap already closes (`renderer.ts:24-25` awaits `boardTrust.load()`).
  The empty-list check (`paths.length ||`) means a user with zero trusted or installed boards gets an IPC call plus a
  disk read on every `list()`. The call-timeout knob governs `.app` calls on board and browser pages alike, but it lives
  in and is named after boards.
- **Refactor:**
  1. Make all imports static except the genuinely heavy editor ones that PLAT-3 has not yet removed.
  2. Replace `currentBoardSources`/`readBoardSources` with `await boardTrust.load(); await boardInstallRegistry.load()`
     (later `BoardRegistry`). Delete `readPaths`, `readInstalled` and both caches.
  3. Add a local `assertBoardFolder(root)`.
  4. Move the timeout knob to `api/ai-vision-call-timeout.ts`, exported as `appCallTimeout` with
     `get`/`set`/`explicit()`. `boards.callTimeoutMs` delegates to it for compatibility.
  5. `installPublished` should use `openBoardInfoPage` (PLAT-3 step 2).
- **Risk / notes:** `boards.callTimeoutMs` is a public agent path, so keep the property.

### PLAT-11: Small cross-process primitives are re-implemented locally (ack channel, serial queue, path containment, coded errors)
- **Priority:** P2
- **Effort:** M
- **Where:**
  - **ordered ack channel, 5 copies:** `src/renderer/api/renderer-capability-channel.ts:5-63`, `src/main/capability-channel.ts:7-63` (line-for-line the same apart from the port API), `src/renderer/ui/speech/SpeechServiceChannel.ts:39-70`, `src/renderer/ui/translation/TranslationServiceChannel.ts:40+`, `src/board-shim.ts`
  - **promise-chain serialization:** `src/renderer/api/board-settings/board-settings-bridge.ts:150-205` (same 3 lines four times in one file), `src/renderer/api/board-settings/BoardSettingsStore.ts:81-88`, `src/renderer/api/board-vars/board-vars-bridge.ts:26-38`, `src/main/site-extension-trust-service.ts:128-132`, `src/main/board-storage.ts`, `src/renderer/editors/board/BoardEditorModel.ts`
  - **path containment:** `src/renderer/api/board-trust.ts:29-31`, `src/main/board-trust-service.ts:53`, `src/main/module-service-supervisor.ts:64`, `src/renderer/api/board-install.ts:35-41`, `src/renderer/api/site-extension-management.ts:10-19`, `src/renderer/api/site-extensions.ts:94-97`, `src/renderer/api/ts-project-registry.ts:135`
  - **"error with code":** `src/renderer/api/capability-bus.ts:164-181`, `src/renderer/api/board-capability-transport.ts:105-117`, `src/renderer/api/module-service.ts:76-92`, `src/renderer/api/board-service-settings.ts:17-23`, `src/renderer/api/capabilities.ts:189-192`
- **Problem:** Each feature carries its own copy of a protocol or helper that needs to be identical everywhere,
  especially the ack-channel window and sequence rules, which must match on both ends.
- **Refactor:**
  1. `src/shared/ack-channel.ts`: `createAckChannel(port: { post(msg), onMessage(cb), onClose(cb), close() },
     limits, sizeOf)`. Renderer and main wrap their port types in 5-line adapters. Speech, translation and capability
     channels use it. The board shim can import the same file at build time.
  2. `src/shared/serial-queue.ts`: `class SerialQueue { run<T>(task): Promise<T> }`. Replace every inline chain.
  3. `fpIsInside(parent, child)` in `core/utils/file-path.ts`, plus a Node equivalent in `main/utils.ts` (or shared with
     an injected normalizer). Replace all seven.
  4. `src/shared/coded-error.ts`: `codedError(code, message)`, `toCodedError(unknown, fallbackCode)`, and an `isCoded`
     guard. `CapabilityError` extends it.
- **Risk / notes:** The ack channel is the riskiest: check board-service, audio and voice-typing channels after the
  swap. The others are mechanical.

### PLAT-12: Board settings and vars stores duplicate their access flow and carry feature-specific migrations
- **Priority:** P3
- **Effort:** S
- **Where:**
  - load/create/unlock sequence twice, only one copy serialized: `src/renderer/api/board-vars/board-vars-bridge.ts:47-58` vs `src/renderer/api/board-vars/admin-api.ts:17-33`
  - Excalidraw legacy migration inside the generic settings bridge: `src/renderer/api/board-settings/board-settings-bridge.ts:29-32,75-134,141,189,201`
  - `subscribeBoardSettings` re-reads and parses the manifest and resolves the namespace on every change event, for every subscriber: `board-settings-bridge.ts:209-229`
- **Problem:** The agent admin API and the board bridge each run "configured? else show the create dialog; locked?
  else unlock", with the same error strings. Only the bridge path is serialized, so an agent call and a board call can
  open two dialogs, which the bridge comment says must not happen (`board-vars-bridge.ts:15-17`). A one-off migration
  for one bundled board is wired into every settings read and write.
- **Refactor:** Move `ensureReady({ interactive })` plus its `SerialQueue` into `BoardEnvStore`, used by both callers.
  Move the Excalidraw migration into a startup migration step (PLAT-6 table, `deferred` phase) gated by its settings
  flag, and delete it from the bridge. In `subscribeBoardSettings`, resolve namespace and declarations once per
  subscription (re-resolve on registry change after PLAT-1).
- **Risk / notes:** The migration currently runs lazily on first access. Running it at start-up must still respect "never
  overwrite an existing value" and the explicit done-flag.

### PLAT-13: Stale comments and small contract violations
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/api/board-trust.ts:5-6`: says trust is a "line-delimited list … `trustedBoards.txt`"; main uses `trustedBoards.json` (overview.md:411)
  - `src/renderer/api/board-install-registry.ts:10-11` and `src/renderer/api/published-boards.ts:3`: "Mirrors `board-trust.ts` … `fs` data-file helpers", no longer true
  - `src/renderer/api/board-updates.ts:7,64-66`: React leftovers ("`useBoardUpdates`", "a hook can't run", "`TrustedBoardsList`", which no longer exists)
  - `src/renderer/api/board-install.ts:113-122`: `installVersion`'s doc block sits orphaned above `uninstallCatalogBoard`
  - `src/renderer/api/window-recording.ts:273-274`: resolves a theme color by `color.background.default.slice(4, -1)` + `getComputedStyle`, contradicting "`resolveColor()` … is the single JavaScript path" (overview.md:354; `src/renderer/theme/themes/index.ts:184`)
- **Refactor:** Fix the comments. Use `resolveColor(color.background.default)`. Move the orphaned doc block back to
  `installVersion`.
- **Risk / notes:** None.

## Cross-area notes

- **`editors/board/board-manifest.ts` (1,044 lines) is the de facto board domain model.** It mixes pure parsing,
  normalization and mask matching with `fs`/`settings` IO (`:1-2,547-570,1027-1038`). Main parses the same manifests
  with `shared/board-manifest-utils`. Moving the pure part to `shared/` is the prerequisite for PLAT-1 and PLAT-3
  (editors reviewer).
- **The renderer half of the board bridge is spread over four places:** `BoardWebview.ts` (postMessage handlers for
  vars, settings, capabilities, navigation return, page state…), `api/mcp/board-*.ts` (main→renderer RPC),
  `api/board-service-settings.ts` (dedicated IPC) and `board-capability-transport.ts`. A single "board bridge host"
  owner with typed method tables would make bridge versions easier to audit, including the recurring missed
  `BOARD_BRIDGE_VERSION` bump.
- **Pages model:** `PagesLifecycleModel.openBoardHandlerPage`/`openBoardRunPage` and
  `PagesQueryModel.findPagesByBoardRoot`/`findBoardRunPage` carry board logic inside `pages/`. They duplicate
  `board-updates.boardPagesForRoot` (PLAT-2).
- **Browser editor:** `BrowserWebviewModel.ts` re-derives site-extension trust status six times (PLAT-8).
- **Main:**
  - `pathCovers` is defined twice (`board-trust-service.ts:53`, `module-service-supervisor.ts:64`).
  - `callerId` derivation (`board-trust-service.ts:467-471`) is a second board-identity rule (PLAT-1).
  - `capability-channel.ts` duplicates the renderer channel (PLAT-11).
- **`api/node-fetch.ts` (other reviewer):** the board network policy check (MCP endpoint needs `appScripting`; the
  `internet` grant rejects private addresses) is written twice, in `src/renderer/api/node-fetch.ts:170-185` and
  `src/main/session-src-protocol.ts:240-252`, with a small difference (main also compares the hostname). Only
  `isPrivateAddress` is shared (`src/shared/board-network-guard.ts:18`). The whole guard should live in that shared
  module.
- **IPC style:** raw `ipcRenderer` use is widespread outside this area too (`audio/audio-window.ts` 18 sites,
  `automation/operations.ts` 12, the browser editor). The PLAT-5 RPC helper should be adopted renderer-wide.
- **`internal/` (KeyboardService, GlobalEventService, RendererEventsService)** are app-shell controllers that import
  `ui/`, `scripting/`, `editors/` and `guides/`. They fit `ui/app/` better than `api/` (PLAT-3).

## Keep

- **Main is the authority for trust, with renderer mirrors** (board trust since US-1538, site extensions). The
  invariant "the API requests, the user's dialog grants" is consistently commented and enforced. Keep both while
  restructuring.
- **`Downloads` (`downloads.ts`):** a `TModel` that subscribes with `own()` in `init()` and is started from the
  app-service descriptor's `initialize`. Use it as the template for PLAT-6/PLAT-7.
- **`BoardNavigationReturnService` (`board-navigation-return.ts`):** one class, one job, explicit active/retired claim
  lifecycle, typed message. Use it as a model for per-feature registries.
- **`TsProjectRegistry` / `ts-project-files.ts`:** small typed records, listener isolation, and a grouped
  tuning-constants block (`ts-project-files.ts:5-13`). It is in the wrong folder, but the design is good.
- **`tools/` split** (manifest / registry / executor / log / stats / trust), each with a clear header stating what it
  deliberately does *not* do (for example, no filesystem watcher).
- **`app-service-registry.ts`:** the type-level exhaustiveness check against `IApp` is a good pattern. Extend it to
  internal services rather than replacing it (PLAT-6).
- **`published-board-display-text.ts`:** a pure, locale-parameterized function with no hidden state.
