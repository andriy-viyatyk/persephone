# Folder Structure

Detailed organization of the codebase. Verified against actual source files.

## Root Structure

```
persephone/
├── src/                    # Source code
│   ├── main/               # Electron main process
│   ├── renderer/           # Native VanillaView frontend
│   ├── ipc/                # IPC communication layer
│   ├── shared/             # Shared types, constants, cross-process helpers, board manifest/value objects and service-channel protocol, plus i18n runtime/catalogs
│   ├── module-service-host/ # Typed utility-process host, split into lifecycle, request, provider, capability, and service-API modules
│   ├── node-script-host/    # Typed entry point for Node-style scripts executed in an Electron utility process
│   ├── test-host/           # Web-app and UI test host, context APIs, app proxy, runner, and reports; json-lines-reporter.ts owns JSONL stdout formatting
│   ├── ipc/                # Cross-process contracts, including test-host startup and test-instance options
│   ├── renderer.ts          # Locale/NLS and synchronous theme preflight; app bootstrap and mount
│   ├── preload.ts          # Preload script (main renderer)
│   ├── board-shim.ts       # Browser IIFE composition root; installs collaborators and assigns window.persephone
│   ├── board-shim/          # Browser-only bridge channels, primitives, and window.persephone feature factories
│   │   ├── primitives.ts    # SettledValue, listener fan-out, and descriptor-preserving API composition
│   │   ├── main-port-channel.ts # Main MessagePort queue, RPC, routing, and teardown
│   │   ├── board-host-frame-channel.ts # Typed host-frame endpoint and deferred outbound queue
│   │   ├── page-api.ts      # Page lifecycle, save/discard, busy, mute, and voice-typing APIs
│   │   ├── source-api.ts    # Source URL, file-path, source-event, and content APIs
│   │   ├── host-content-api.ts # Content-host API
│   │   ├── shared-state-api.ts # Shared board state and variables APIs
│   │   ├── chrome-api.ts    # Toolbar, status bar, navigation, and chrome APIs
│   │   ├── settings-api.ts  # Board settings API
│   │   ├── themes-api.ts    # Theme, token, and graph-palette APIs
│   │   ├── i18n-api.ts      # Board localization API
│   │   ├── files-api.ts     # File, watch, project, and board-open APIs
│   │   ├── service-api.ts   # Board service and provider APIs
│   │   ├── capability-api.ts # Intent and capability APIs
│   │   ├── fetch-api.ts    # Board fetch API and stream lifecycle
│   │   ├── ai-vision-api.ts # AiVision exposure and remote lifecycle
│   │   ├── storage-api.ts  # Storage, page state, and clipboard APIs
│   │   ├── execute-api.ts  # Command execution APIs
│   │   ├── bridge-actions-api.ts # Link, notification, and bridge actions
│   │   ├── icons-api.ts    # Board icon resolution
│   │   ├── dialogs.ts     # Synchronous board dialog calls
│   │   ├── frame-behaviours.ts # Keyboard, link, overlay, context-menu, and diagnostics setup
│   │   ├── service-port-inbox.ts # Early service-channel port buffering and delivery
│   │   ├── board-context-menu.ts # Board-frame context menu and image/editable-field actions
│   │   └── board-console-mirror.ts # Board errors and console warnings/errors sent to the host
├── launcher/               # Rust launchers (Windows named-pipe client and console test-runner shim)
│   ├── src/main.rs
│   ├── build.rs
│   └── Cargo.toml
├── scripts/                # Build scripts
│   ├── dev.mjs             # Dev orchestrator (npm start) — Vite renderer dev server + HMR, Node-targeted main build, watch-builds main/preload/preload-webview/board-shim/search-worker/utility-process hosts, launches Electron with restart-on-change
│   ├── build-prod.mjs      # Vite production build — Node-targeted main plus preload, preload-webview, renderer, board-shim, search-worker, and ESM utility-process hosts
│   ├── build-board-lib.mjs # Manual Excalidraw vendor-graph snapshot generator (run only when its pinned version changes)
│   ├── build-rest-client-lib.mjs # Build the REST Client board's committed CodeMirror browser module
│   ├── i18n-check.mjs      # Bundle and run the language-pack validation command
│   ├── i18n-check-entry.ts # Check pack completeness/source hashes and generated en-XA
│   ├── typecheck-strict.mjs # Per-folder strictNullChecks gate run by `npm run typecheck`
│   ├── i18n-export.mjs     # Export the English app catalog as pack-drafting JSON
│   └── vmp-sign.mjs        # electron-builder afterSign hook for Widevine VMP signing
├── assets/                 # Static assets
│   ├── editor-types/       # GENERATED — Vite plugin auto-copies .d.ts files from src/renderer/api/types/ (never hand-edit)
│   ├── icons/              # App icons
│   ├── languages/          # Built-in app language packs and their authoring/validation notes
│   ├── excalidraw/fonts/   # Self-hosted Excalidraw fonts (woff2, OFL-1.1 licensed)
│   ├── script-library/     # Bundled example scripts (copied to user library on setup)
│   ├── guides/             # Shared user and agent guide corpus, shipped inside the app
│   │   ├── agents/         # Agent-facing application and automation guides
│   │   ├── editors/        # User-facing editor guides
│   │   ├── screens/        # User-facing per-screen chrome and layout guides
│   │   ├── formats/        # Structured editor formats
│   │   └── scripting/      # Scripting guide and API reference
│   ├── board-base.css      # Shared board stylesheet copied into every board — theme defaults + the opt-in .p-* chrome layer
│   ├── board-template/     # Starter files copied into every new blank board
│   ├── board-template-header.md # Board-local header prepended to its generated CLAUDE.md
│   ├── guides/agents/boards/ # Canonical board authoring guide (hub + pages); the hub is filtered into new blank boards
│   ├── boards/             # Boards shipped inside the installer resources
│   │   ├── excalidraw/     # Bundled Excalidraw board, manifest, library fetcher, and committed prebuilt lib/
│   │   └── rest-client/    # Bundled REST Client board (plain JavaScript)
│   ├── tool-template/      # Scaffold copied into every new toolset
│   │   ├── tools-manifest.json # Example manifest (one echo tool)
│   │   ├── echo.js         # Example stdin-JSON tool with the ##PERSEPHONE_RESULT## contract
│   │   ├── .env.example    # Required env var names (no values)
│   │   ├── .gitignore      # Ignores .env
│   │   └── CLAUDE.md       # Toolset authoring guide (manifest, stdin/stdout contract, .env, requirements)
│   ├── demo-board/         # Bundled Demo board — exercises the full board surface
│   └── test-suite-template/ # Offline starter suite copied by `persephone-test --init`
├── snip-tool/              # Rust native screen snip and Windows clipboard helper (persephone-snip.exe on Windows, persephone-snip on Linux)
│   ├── src/main.rs         # Entry point, PNG encoding, stdout output, platform-gated subcommand dispatch
│   ├── src/screenshot_linux.rs # Interactive desktop Screenshot portal capture on Linux/Wayland
│   ├── src/capture.rs      # Monitor enumeration + GDI screen capture
│   ├── src/clipboard.rs    # CF_HDROP file-list read/write interop
│   ├── src/clipboard_watch.rs # Win32 clipboard listener and JSON-lines change/health protocol
│   ├── src/overlay.rs      # Fullscreen overlay windows, selection UI
│   ├── build.rs
│   └── Cargo.toml
├── mneme/                  # Rust knowledge-base / vector-memory service (mneme.exe) — standalone, extraction-ready
│   ├── src/main.rs         # CLI: serve / reindex / watch / status / model-update / embed / search
│   ├── src/config.rs       # config: wiki roots, include/ignore globs, transport, model, gpu
│   ├── src/store/          # Document Store over wiki roots (read/write/edit/glob/grep, {root}/{path})
│   ├── src/markdown/       # YAML frontmatter parse + heading chunker
│   ├── src/index/          # per-root SQLite index (FTS5 + sqlite-vec); hybrid search + RRF; versioned DB path
│   ├── src/indexer/        # reconcile + cancellable reindex job (keeps the index in sync with files)
│   ├── src/watcher/        # always-on per-root file watcher
│   ├── src/embed/          # embedding engine (ort + tokenizers, DirectML→CPU) + priority-queue worker
│   ├── src/model/          # model provisioner (download + sha256 + cache)
│   ├── src/mcp/            # MCP server (Streamable HTTP) — wiki_* tools + mneme:// resources
│   ├── assets/             # models.json manifest + wiki-guide.md (agent guide resource)
│   ├── Cargo.toml
│   └── README.md           # crate-local docs (module layout, build/test, invariants) — primary reference
├── boards-assets/          # Recommended-components catalog for Boards
│   ├── manifest.json       # Catalog index (id, label, files, description per skin)
│   ├── README.md           # Adoption playbook
│   └── *.css / *.js        # Pre-built skins: tabulator, chart-theme, flatpickr, tom-select,
│                           #   markdown, mermaid-theme, split, sortablejs, tippy, dialog
│                           #   (av-grid, the default grid, is in the catalog with NO skin —
│                           #    it reads the --p-* contract itself)
├── qa/                     # MCP QA suite organized by application surface
│   ├── surfaces/           # Tests grouped by the application surface under test
│   │   └── editors/        # Manual call-only checks for editor facades and controls
│   └── runs/               # Recorded test-agent runs
├── integration-test/       # Developer-only UI suite wrapper, tests, fixtures, and isolated run profile
├── patches/                # Dependency patches (patch-package)
├── .mcp.json               # MCP server config for Claude Code (points to MCP HTTP server)
├── doc/                    # Developer documentation
│   ├── architecture/       # Architecture docs (this folder)
│   ├── standards/          # Coding standards and guides
│   ├── tasks/              # Task tracking
│   └── future-architecture/ # Migration design docs (historical)
```

The user-facing pages in `/assets/guides/` are the canonical in-app copy; users read them in the
About page or with `F1`.

The UI integration suite wrapper in `/integration-test/` owns suite discovery, fixture seeding,
profile lifecycle, area/name filters and aggregate reports. Generic test execution lives in
`/src/test-host/` and `/src/main/test-mode/`, and can also run tests against a user's web-app
profile. See `/doc/standards/integration-tests.md` for process ownership, runner options and
workflow.

Guide indexing is shared across processes: `/src/shared/guides/` owns the corpus contract and
mounted-source composition, `/src/main/mcp/ai-vision/` resolves trusted-board guide mounts for MCP,
and `/src/renderer/guides/` resolves the corresponding mounts for the About browser and `F1`.

The shared board-pipe helpers are deliberately process-neutral: `/src/shared/range-utils.ts` parses
inclusive ranges and builds Content-Range values; `/src/shared/board-pipe-constants.ts` holds the
board-pipe IPC chunk and fallback-buffer limits. `/src/shared/board-network-guard.ts` contains the
shared private-address check and DNS-pinned lookup used for board network requests. `/src/shared/mime-types.ts` maps filename
extensions to MIME types for main and renderer consumers. The main-process
`/src/main/board-pipe-range-reader.ts` owns board-pipe range resolution, reply validation, and
bounded continuation reads for both board protocol and video-stream responses.

The renderer dev server ignores `snip-tool/target/`, `mneme/target/`, `launcher/target/`, and
`release/` in its Vite watcher. These are build outputs rather than import sources; watching them
can race a concurrent Cargo or packaging build, surface `EBUSY` from chokidar, and bring down the
dev server.

## Renderer Structure

The renderer API includes `api/ui-preferences.ts`, a synchronous cache for scalar UI preferences
owned and persisted by the main process. It is hydrated during service initialization so page
construction never waits for a preference read. Board domain services and policy now live under
`src/renderer/api/boards/`; `src/renderer/api/boards.ts` remains the `app.boards` facade, while
`src/renderer/editors/board/` contains the board editor and its native views. The shared board
manifest schema, `BoardGrant`, and `BoardRoot` are process-neutral value objects in
`src/shared/board/`. The `api/boards/` directory groups board-specific collaborators such as
manifest I/O, trust and grant handling, root identity, board localization, bundled and custom editor
registries, published-catalog access, install/update flows, and board-host helper services. The
board editor directory retains the editor model, views, webview, automation adapter, and visual
components; its `BoardsPanelEditorModel` and `BoardsSecondaryView` own the optional Boards panel.
The process-neutral `src/shared/board/board-explorer-root.ts` owns the fallback order for a new
board-page Explorer. `src/renderer/editors/board/model/BoardWorkingFolder.ts` owns a transient
working-folder declaration, and `frame/working-folder-bridge.ts` routes its trusted main-frame API.
The optional Clipboard panel has a separate editor and view under `src/renderer/editors/clipboard/`,
while its history state and IPC operations live in `src/renderer/api/clipboard-history.ts`; board://
pipe resources are served from `src/renderer/content/pipe-resource-server.ts`.

The renderer entry is `src/renderer.ts`: after asynchronous application bootstrap it calls
`mount(container)` exported by `src/renderer/index.ts`. The application shell, coupled views,
editors, and UIKit are framework-free `VanillaView` classes. Native global styles are installed by
`theme/global-styles.ts`.

```
/src/renderer/
│
├── api/                    # Object Model — application interfaces
│   ├── app.ts              # Root App class (bootstrap orchestrator)
│   ├── core-bootstrap.ts # Guard reporter and app-backed OsFile/ILink trait registration
│   ├── app-startup.ts       # Ordered internal startup phases and sequencing constraints
│   ├── app-service-registry.ts # Descriptor table for lazy app services and optional initialization
│   ├── capability-error.ts  # Shared renderer capability errors and normalization
│   ├── capabilities/        # Script capability client, typed-RPC open server, handlers, validators, board dispatcher, frame adapter, and index mirror
│   ├── editor-categories.ts # EditorCategoriesModel; category setting and exclusive editor/board membership
│   ├── translation/         # Trusted text-translation provider channel and shared routing/workflow services
│   │   ├── TextTranslationProvider.ts
│   │   └── TranslationWorkflow.ts
│   ├── clipboard-history.ts # ClipboardHistoryModel; history/status state, monitoring, IPC, and race guards
│   ├── creatable-items.ts   # Creatable-item registry for the Editors tree and new-page menu
│   ├── ai-vision-call-timeout.ts # Session call-timeout setting owner
│   ├── themes.ts           # Script/MCP application theme service (`app.themes`)
│   ├── theme-service.ts     # Applies selected themes from settings changes
│   ├── custom-theme-storage.ts # Validated custom theme persistence and cross-window watching
│   ├── settings.ts         # ISettings runtime store and typed subscriptions
│   ├── settings-schema.ts  # Ordered setting defaults, normalization, options, ranges, and migrations
│   ├── settings-effects.ts # Settings-driven process and feature side effects
│   ├── browser-profiles.ts # Internal browser-profile rules, partition lookup, and permission IPC
│   ├── site-extensions.ts  # Site-extension validation, listings, and trust summary
│   ├── speech/             # Shared speech provider, typed session and microphone services
│   │   ├── SpeechTranscriptionProvider.ts
│   │   ├── SpeechSessionClient.ts
│   │   ├── MicrophoneCapture.ts
│   │   ├── microphone-settings.ts # Microphone capture options; device, status and retry service
│   │   └── voice-typing/    # App-level service and per-session voice-typing collaborators
│   ├── board-settings/     # Board-declared settings catalog, persistence, and bridge-facing reads
│   │   ├── BoardSettingsStore.ts       # Renderer-lifetime board-settings.json store and change notifications
│   │   ├── board-settings-bridge.ts    # Effective reads/writes/resets and board-frame change delivery
│   │   ├── types.ts                    # Board setting declarations, scalar values, file shape, and multiselect codec
│   │   └── index.ts                    # Board settings exports
│   ├── editors.ts          # IEditorRegistry implementation
│   ├── recent.ts           # IRecentFiles implementation
│   ├── fs.ts               # IFileSystem implementation
│   ├── file-watcher.ts     # FileWatcher and DirectoryWatcher over the path-watch service
│   ├── copy-files.ts       # Recursive local file/folder copy and move operations
│   ├── clipboard.ts        # Renderer text clipboard write through main-process IPC
│   ├── archive-service.ts  # ArchiveService — archive I/O (libarchive-wasm for reads, jszip for writes), used by fs.ts for archive paths
│   ├── window.ts           # IWindow implementation and app.window.screen host
│   ├── window-screen.ts    # Shared automation adapter for the complete app window
│   ├── window-recording.ts # Per-window MediaRecorder capture, crop, state, and lifecycle
│   ├── audio-capture-state.ts # Per-window audio-capture count and IPC revision guard
│   ├── menu-bar.ts         # MenuBarModel — reactive Menu Bar openness, folder selection, and legacy opener bridge
│   ├── ui.ts               # IUserInterface implementation
│   ├── dialogs/            # Dialog and app-popup models, state, types, and public show helpers
│   │   ├── dialogs-state.ts # Dialog/popper state and close lifecycle events
│   │   ├── dialog-types.ts  # Shared dialog/popper data and model contracts
│   │   ├── dialog-view-registry.ts # View ID to native dialog/popover constructor registry
│   │   ├── showPopupMenu.ts # App popup-menu model/state and callback activation
│   │   └── grid-context-menu.ts # Grid menu adaptation to app popup menus
│   ├── downloads.ts        # IDownloads implementation
│   ├── menu-folders.ts     # IMenuFolders implementation
│   ├── library-service.ts  # LibraryService — script library scanning, caching, file watching and folder actions
│   ├── autoload-service.ts # Thin wrapper exposing AutoloadRunner to app lifecycle
│   ├── pages.ts            # PagesModel singleton export
│   ├── renderer-rpc-bootstrap.ts # Registers renderer RPC handlers and starts the server
│   ├── renderer-rpc.ts     # Renderer RPC server (in api/)
│   ├── mcp/                # MCP call adapter and request history/log
│   │   ├── mcp-call-rpc.ts # MCP call RPC handler; creates a ScriptContext and resolves AiVision
│   │   └── request-log.ts  # Bounded MCP request history and server-log page integration
│   ├── boards/board-host-rpc.ts # Typed board-call/theme/open and TS-project RPC handlers
│   ├── boards/board-page-router.ts # Board-specific page open interception, routing and queries
│   ├── tools/              # Internal Agent Tools registry and plain typed operations
│   │   ├── tool-search.ts  # Search registered tools
│   │   └── toolset-operations.ts # Refresh and create/register toolsets
│   ├── mneme-connection.ts # Shared, persistent Mneme MCP client — one auto-reconnecting connection; refcounted resource subscriptions fanned out to per-document watchers
│   ├── mneme-status.ts     # Mneme health prober + reactive status (shared MCP connection; drives sidecar launch, indicators, and auto-opens the config editor when no model is provisioned)
│   ├── mneme-client.ts     # Typed Mneme tool client — owns tool calls, result parsing, progress parsing, and root index inventory
│   ├── mneme-types.ts      # Shared Mneme tool result and domain types
│   ├── proc.ts             # IProc implementation (app.proc.execute) — the ipcRenderer transport for the shared execute() handle (shared/execute-handle.ts); compile-time drift guard keeps it in sync with runner-channels.ts
│   ├── terminal.ts         # openTerminalAt(dir) helper — reads terminal.command, auto-detects pwsh→powershell→cmd on first use and saves it, then launches ("Open Terminal here")
│   ├── module-service.ts   # Renderer client for main-routed service requests, direct board channels, and the optional per-window host-renderer lease
│   ├── module-service-tree-availability.ts # Board-root/type notifications when a tree provider registers again
│   ├── board-service-settings.ts # Trust- and service-gated settings reads/subscriptions for host-managed board services
│   ├── ts-project-files.ts # Bounded tsconfig-based TypeScript project file selection
│   ├── ts-project-registry.ts # Board-owned TypeScript project roots and file lookup
│   ├── module-service-status.ts # MainSnapshotMirror for main-owned module-service status
│   ├── boards/board-registry.ts # MainSnapshotMirror of the full board trust/grant/file-access snapshot
│   ├── boards/board-lifecycle.ts # Shared board removal, rename, install, and idle lifecycle
│   ├── boards.ts           # IBoards implementation (app.boards) — board lifecycle, trusted-board shortcut/window operations, and published-catalog ops (search/download/install/uninstall/updates)
│   ├── internal.ts         # Disposable utilities (wrapSubscription, etc.)
│   │
│   ├── board-vars/         # Board environment-variables store — secrets kept outside the board folder
│   │   ├── BoardEnvStore.ts    # Session-singleton tolerant runtime reader over the settings-configured .env.json (shared parser; encryption reuse)
│   │   ├── board-vars-bridge.ts # Orchestrates a board's persephone.var.* request against ITS namespace (create-storage dialog, locked handling, serialized chain)
│   │   ├── admin-api.ts        # BoardVarsAdmin — app.boardVars, unrestricted-namespace admin surface for scripts/agents
│   │   ├── types.ts            # BoardVarsFile schema, shared parser, strict editor validator, DEFAULT_PROFILE
│   │   └── index.ts            # Barrel
│   │
│   ├── tools/              # Internal Agent Tools registry — deliberately not exposed as app.tools
│   │   ├── tools-manifest.ts   # tools-manifest.json module — read/validate/write; isToolsetFolder; defaultToolsManifest
│   │   ├── tools-trust.ts      # toolsTrust registry — registered toolset roots (trustedTools.txt), exact-match, reactive; registration ≡ trust
│   │   ├── registered-tools.ts # registeredTools model — enumerate trusted roots → read manifests → flat tool list (id = <toolset>/<tool>); refresh(), reactive
│   │   ├── tool-executor.ts    # executeToolById — resolve → validate args → app.proc.execute (cwd = toolset root, stdin-JSON args, .env env); output contract + failure payload
│   │   ├── dotenv.ts           # loadDotEnv — parse <root>/.env via Node util.parseEnv (no dependency)
│   │   ├── tool-log.ts         # Self-rotating per-toolset tools-execution.log (TOOLS_EXECUTION_LOG_FILE)
│   │   ├── tool-stats.ts       # In-memory per-tool run stats
│   │   └── tool-scaffold.ts    # createToolset(name, dir) — copy tool-template + patch manifest name (trust-free; NOT on app/scripts)
│   │
│   ├── pages/              # Page collection — composed submodels
│   │   ├── PageModel.ts            # Tab container — editor membership, sidebar and main editor; restore/recovery collaborators
│   │   ├── page-tab-state.ts        # Tab presentation and shared tab-action predicates
│   │   ├── IPageHost.ts            # IPageHost interface — editor↔owner contract (PageModel + BrowserPanelHost)
│   │   ├── PageRestore.ts          # Deferred restore state, cancellation, readiness and typed retry
│   │   ├── RecoveryPlaceholder.ts  # Failed-restore descriptor, retry/close coordination and cache protection
│   │   ├── StartupPageRestore.ts    # Startup placeholders, renderer-ready gate, retry and completion signals
│   │   ├── PageRecovery.ts          # Identity-checked recovery-page reconstruction and replacement
│   │   ├── SecondaryViewsModel.ts  # Reactive sidebar layout state (open, width, activePanel)
│   │   ├── panel-key.ts            # Composite panel-key helpers (`${editorId}::${panelId}`)
│   │   ├── PagesModel.ts           # Base: state, subscriptions, composes submodels
│   │   ├── PagesQueryModel.ts      # Queries: page lookup and normalized file identity
│   │   ├── PagesNavigationModel.ts # Navigation: show, focus, next/prev
│   │   ├── PagesLifecycleModel.ts  # Lifecycle: create/open/close, transfer, retry; generic open interceptors
│   │   ├── standalone-pages.ts     # Fixed-ID page registry and custom page builders
│   │   ├── PageNavigator.ts        # navigatePageTo — named steps, same-file reveal, existing page navigation
│   │   ├── NavBackStack.ts         # Markdown back-nav stack owned by the page (persisted)
│   │   ├── PagesLayoutModel.ts     # Layout: grouping, pinning and compare-mode cleanup
│   │   └── PagesPersistenceModel.ts # Persistence: save/restore, debounced
│   │
│   ├── internal/           # Event services (init-only, not public API)
│   │   ├── GlobalEventService.ts    # contextmenu, dragover, drop, paste (image capture; rich HTML bubble fallback with handled/editable/grid stand-downs), unhandled rejections
│   │   ├── clipboard-image.ts       # Paste helpers: image file → Image viewer (capture); any rich HTML → HTML viewer (bubble fallback)
│   │   ├── KeyboardService.ts       # Global keyboard shortcuts
│   │   ├── WindowStateService.ts    # Window maximize/zoom state tracking
│   │   └── RendererEventsService.ts # IPC event subscriptions (open file, quit, etc.)
│   │
│   ├── events/             # Event channel system (scriptable events)
│   │   ├── AppEvents.ts             # app.events namespace (linkContextMenu, fileExplorer, etc.)
│   │   ├── BaseEvent.ts             # Base event class with `handled` flag
│   │   ├── EventChannel.ts          # EventChannel<T> — subscribe, send, sendAsync, dispose
│   │   ├── events.ts                # Event subclasses (ContextMenuEvent<T>, etc.)
│   │   └── index.ts
│   │
│   ├── shell/              # Shell service — OS integration
│   │   ├── index.ts                 # IShell facade (composes sub-services)
│   │   ├── shell-calls.ts           # IPC calls to main process
│   │   ├── encryption.ts            # AES-GCM encryption
│   │   ├── version.ts              # Version info, update checking
│   │   └── snip-to-new-page.ts      # Screen-snipping workflow and new-page navigation
│   │
│   ├── setup/              # Monaco editor configuration
│   │   ├── configure-monaco.ts      # Themes, keybindings, type definitions
│   │   ├── library-intellisense.ts  # Library module IntelliSense (addExtraLib + path completion)
│   │   └── monaco-languages/        # Custom language definitions
│   │       ├── csv.ts               # CSV rainbow coloring
│   │       ├── jsonl.ts            # JSONL (JSON Lines) syntax highlighting
│   │       ├── log.ts              # Log file syntax highlighting
│   │       ├── mermaid.ts           # Mermaid syntax highlighting
│   │       ├── patch.ts            # Patch/diff structural syntax highlighting
│   │       └── reg.ts              # Windows Registry file syntax
│   │
│   └── types/              # TypeScript interfaces (.d.ts)
│       ├── index.d.ts      # Global `app` and `page` declarations
│       ├── app.d.ts        # IApp interface
│       ├── capabilities.d.ts # ICapabilities and built-in handoff payloads
│       ├── themes.d.ts      # IThemes and custom theme data contracts
│       ├── common.d.ts     # IDisposable, IEvent, Language
│       ├── pages.d.ts      # IPageCollection interface
│       ├── page.d.ts       # IPage interface (with `editor` and `editorSwitches`)
│       ├── page-panels.d.ts # IPagePanels — live page sidebar panel surface
│       ├── settings.d.ts   # ISettings
│       ├── editors.d.ts    # IEditorRegistry
│       ├── boards.d.ts     # IBoards (app.boards) — board lifecycle API
│       ├── board-vars.d.ts # IBoardVars (app.boardVars) — env-vars/secrets admin API
│       ├── tools.d.ts      # ITools/IToolsets root-only call-tree contract (not app.tools)
│       ├── recent.d.ts     # IRecentFiles
│       ├── fs.d.ts         # IFileSystem
│       ├── window.d.ts     # IWindow and IWindowScreen
│       ├── shell.d.ts      # IShell + sub-services
│       ├── ui.d.ts         # IUserInterface and IAlerts
│       ├── downloads.d.ts  # IDownloads
│       ├── menu-folders.d.ts # IMenuFolders
│       ├── text-editor.d.ts    # ITextEditor
│       ├── grid-editor.d.ts    # IGridEditor
│       ├── link-editor.d.ts    # ILinkEditor
│       ├── browser-editor.d.ts # IBrowserEditor and shared automation result types
│       ├── markdown-editor.d.ts # IMarkdownEditor
│       ├── svg-editor.d.ts     # ISvgEditor
│       ├── html-editor.d.ts    # IHtmlEditor
│       ├── mermaid-editor.d.ts # IMermaidEditor
│       ├── env-vars-editor.d.ts # IEnvVarsEditor — environment-variable state and actions
│       ├── archive-editor.d.ts # IArchiveEditor — archive entries and extraction
│       ├── folder-view-editor.d.ts # IFolderViewEditor — provider-backed folder navigation
│       ├── git-tree-editor.d.ts # IGitTreeEditor — Git history, refs, and changes
│       ├── log-view-editor.d.ts # ILogViewEditor — Log View entries and non-blocking output
│       ├── events.d.ts       # IEventChannel, IBaseEvent, IContextMenuEvent, MenuItem, IFileTarget
│       ├── io.d.ts            # IIoNamespace — script `io` global (providers, transformers, tree providers, createPipe)
│       ├── io.provider.d.ts  # IProvider, IProviderStat, IProviderDescriptor
│       ├── io.transformer.d.ts # ITransformer, ITransformerDescriptor
│       ├── io.pipe.d.ts      # IContentPipe, IPipeDescriptor
│       ├── io.link-data.d.ts # ILinkData plus StoredLinkData — composable pipeline and persistence shapes
│       └── io.tree.d.ts     # ITreeProvider, ILink (was ITreeProviderItem), ITreeStat, ITreeSearch*
│
├── content/                # Content delivery layer — providers, transformers, pipes
│   ├── guide-links.ts       # Shared persephone-guide:// parsing and resolution helpers
│   ├── ContentPipe.ts      # IContentPipe implementation, createPipe() factory
│   ├── PipePair.ts         # Paired TextFile source/cache pipe ownership and disposal
│   ├── registry.ts         # Provider/transformer registries, createPipeFromDescriptor()
│   ├── board-provider-factory.ts # Trusted-board ProxyProvider factory
│   ├── scheme-registry.ts  # Platform/script URL-scheme parse and resolve hooks
│   ├── page-scheme-handoff.ts # Board-claimed scheme check, per-origin Allow/Block answers, hand-off of page-requested URLs
│   ├── builtin-schemes.ts  # Built-in URL-scheme registrations and handlers
│   ├── parsers.ts          # Layer 1: scheme dispatch plus file/archive and cURL/fetch adapters on openRawLink
│   ├── resolvers.ts        # Layer 2: registered-scheme dispatch plus fallback pipe resolvers on openLink
│   ├── link-handoff.ts     # Shared handled reset/delegate/finalize sequence for scheme hand-offs
│   ├── open-actions/       # Layer 3 execution of typed browser, folder, capability and notice actions
│   │   ├── dispatch.ts
│   │   ├── browser.ts
│   │   ├── folder-page.ts
│   │   ├── capability.ts
│   │   └── notice.ts
│   ├── link-utils.ts       # URL → pipe descriptor resolution and shared URL path/fragment helpers
│   ├── rebuild-pipe.ts     # Rebuilds pipes from persisted source paths or source links, preferring saved pipe descriptors where available
│   ├── source-watch.ts     # Shared provider-availability and moved-source watch lifecycle
│   ├── source-recovery.ts  # Shared typed provider-error reporting
│   ├── open-handler.ts     # Layer 3: open handler on openContent — creates/navigates pages
│   ├── folder-editor-link.ts # folder-editor:// UTF-8-safe board-folder link; maps built-in folder ids to their existing links
│   ├── persephone-board-link.ts # persephone-board:// link encode/decode (addresses a board root); dispatched by the registered-scheme adapter → target "board-view"
│   ├── persephone-toolset-link.ts # persephone-toolset:// link encode/decode (addresses a toolset root) + openToolset() helper; dispatched by the registered-scheme adapter → target "toolset-view"
│   ├── mneme-folder-link.ts # mneme-folder:// link encode/decode (addresses a Mneme root)
│   ├── mneme-link.ts        # mneme:// document scheme — canonical href ⇄ MCP address (toMnemeHref / toMnemeAddress)
│   ├── providers/
│   │   ├── FileProvider.ts      # IProvider for local binary files (read/write/watch/stat)
│   │   ├── CacheFileProvider.ts # IProvider for cache files by page ID (auto-save)
│   │   ├── HttpProvider.ts      # IProvider for HTTP/HTTPS URLs (read-only)
│   │   ├── DataUrlProvider.ts  # IProvider for data: URLs (inline content, read-only)
│   │   ├── MnemeProvider.ts    # IProvider over the shared Mneme connection — read/write/edit a document, live-refresh on resource updates
│   │   ├── ProxyProvider.ts     # IProvider delegate to a trusted board module service over its window's renderer lease
│   │   └── GuideProvider.ts     # IProvider for packaged Markdown guides (read-only)
│   ├── transformers/
│   │   ├── ArchiveTransformer.ts # ITransformer for archive entry extraction/replacement
│   │   └── DecryptTransformer.ts # ITransformer for AES-GCM decrypt/encrypt (non-persistent)
│   ├── tree-providers/           # ITreeProvider implementations
│   │   ├── FileTreeProvider.ts  # Local filesystem directories
│   │   ├── ArchiveTreeProvider.ts # Archives (ZIP, RAR, 7z, TAR, cab, ISO — read-only)
│   │   ├── ProxyTreeProvider.ts # Trusted board service tree over the module-service provider channel
│   │   ├── board-tree-watches.ts # Explorer folder-watch intents and replay when the service registers again
│   │   ├── tree-provider-factory.ts # Type-to-provider construction shared by tree hosts
│   │   ├── tree-provider-identity.ts # Stable identity for persisted board tree sources
│   │   ├── tree-provider-capabilities.ts # Classified watch batches and internal provider capability predicates
│   │   ├── tree-provider-link.ts # tree-category:// link format (encode/decode)
│   │   ├── MnemeTreeProvider.ts  # ITreeProvider over a Mneme root — browse like a filesystem; create/rename/delete; drag-drop import
│   │   └── mnemeLinkTraits.ts    # MnemeLink TraitSet (LINK + FILE_LINK) for tree drag-drop (move within / copy across roots)
│   └── open-with-default-app.ts # Hand a path to the OS shell (shell.openPath); shared by the tree context menu and Explorer double-click
│
├── audio/                  # Hidden audio-window host and reusable capture/DSP components
│   ├── audio-window.ts     # Thin IPC host for capture/playback collaborators
│   ├── CaptureSourcePool.ts # Capture-source lifecycle and subscriptions
│   ├── PlaybackChannel.ts  # Playback scheduling and channel lifecycle
│   └── dsp/                # PCM capture, loopback reference, gate, DTLN pipeline and worker
├── ui/                     # Application Shell
│   ├── link-menus/          # App-level link and file menu builders
│   │   ├── tree-context-menus.ts # Default context menu handlers for tree provider items
│   │   └── open-with-editor.ts   # Shared Open with submenu and editor selection action
│   ├── app/                # Root shell
│   │   ├── MainPageView.ts         # Native root layout and view lifecycle
│   │   ├── AppHeaderView.ts        # App-window header composition
│   │   ├── BoardWindowHeaderView.ts # Board-window header composition
│   │   ├── HeaderStatusIndicatorsView.ts # App-only status indicators
│   │   ├── RecordingControlsView.ts # Recording controls and chrome snapshot
│   │   ├── GlobalMuteButtonView.ts # Shared app-level mute control
│   │   ├── header-buttons.ts       # Shared window and system-button builders
│   │   ├── HeaderQuickSettingsPopover.ts # Header snip/record actions and live service switches
│   │   ├── PagesView.ts            # Native page container/router
│   │   ├── RenderEditorView.ts      # Native editor dispatcher
│   │   ├── AsyncEditorView.ts      # Native async editor loader and error surface
│   │   └── PageContentView.ts        # Native page content and editor lifecycle
│   ├── voice-typing/       # Non-interactive app-shell status overlay for speech capture/transcription or translation
│   │   ├── VoiceTypingOverlayView.ts # App-shell recording/transcribing status overlay
│   │   └── VoiceTypingOverlayView.css
│   ├── tabs/               # Tab bar
│   │   ├── PageTabsView.ts         # Native tab strip and scroll projection
│   │   ├── PageTab.ts              # Tab props/constants and shared helpers
│   │   ├── PageTabView.ts          # Native tab presentation, drag, and activation behavior
│   │   └── PageTabs.css
│   ├── sidebar/            # Sidebar/menu panel
│   │   ├── MenuBarView.ts          # Native top menu bar
│   │   ├── menu-bar-folder-ui.ts   # Built-in and generic folder UI table
│   │   ├── OpenTabsListView.ts      # Native open-tabs list
│   │   ├── RecentFileListView.ts    # Native recent-files panel
│   │   ├── ToolsEditorsPanelView.ts # Native Tools & Editors panel
│   │   ├── ScriptLibraryPanelView.ts # Native script-library panel
│   │   ├── FolderItemView.ts        # Native folder tree item
│   ├── dialogs/            # Application dialogs
│   │   ├── DialogsView.ts          # Native dialog host
│   │   ├── ModelViewSlotHost.ts    # Shared keyed dialog/popper view reconciler
│   │   ├── register-dialog-views.ts # Shell-time registrations for native views
│   │   ├── ConfirmationDialogView.ts
│   │   ├── InputDialogView.ts
│   │   ├── PasswordDialogView.ts
│   │   ├── TorInfoDialogView.ts
│   │   ├── RegisterToolsetDialogView.ts
│   │   ├── CreateBoardVarsStorageDialogView.ts
│   │   ├── NamespaceCollisionDialogView.ts
│   │   ├── TextDialogView.ts
│   │   ├── progress/               # Progress overlay, notifications, screen lock
│   │   │   ├── ProgressModel.ts    # State + API (showProgress, createProgress, notifyProgress, addScreenLock)
│   │   │   └── ProgressOverlay.ts  # Two-zone overlay model
│   │   ├── poppers/                # Floating menus
│   │   │   ├── PoppersView.ts      # Native popper host
│   │   │   └── AppPopupMenuView.ts # Native app popup-menu view
│
├── editors/                # Editor Implementations — each editor is an EditorModel subclass
│   ├── editor-factory.ts   # Shared editor construction for pages and navigation
│   ├── tab-title-registry.ts # Editor-specific page-tab display-title formatters
│   ├── base/               # Shared editor infrastructure
│   │   ├── EditorModel.ts            # Abstract base class for all editors; includes displayTitle
│   │   ├── audible-editor.ts          # Optional sound-control contract for audio-owning editors
│   │   ├── TextHostEditorModel.ts    # Base for TextFileModel-wrapping editors — host-adoption lifecycle, subscription registry, content echo guard, host-settings mirror
│   │   ├── editor-traits.ts          # Content-host, text-selection, and text-navigation transfer contracts
│   │   ├── editor-traits.ts          # CONTENT_HOST_TRAIT — owner-orchestrated editor switching
│   │   ├── tree-provider-host.ts      # Tree-provider host trait, provider/selection/reveal state, and mounted-tree reveal controller
│   │   ├── view-port.ts               # Typed, identity-safe mounted-view capability registration
│   │   ├── editor-matchers.ts        # Acceptance / resolution priority helpers
│   │   ├── editorRegistry.ts         # Native editor registry — resolve, register, switch options
│   │   ├── editor-switch.ts          # switchMainEditor — switch-widget transition (host transfer / rebuild)
│   │   ├── PageToolbarView.ts        # Native page toolbar — NavPanel + switch widget auto-slots
│   │   ├── TextChromeView.ts         # Native host-aware chrome (toolbar, script panel, footer)
│   │   ├── TextEditorPageView.ts    # Shared text page shell with retained body and contribution slots
│   │   ├── text-chrome-contributions.ts # Shared script and editor toolbar contributions
│   │   ├── EditorToolbarView.ts      # Native toolbar root used by individual editors
│   │   ├── EditorStatusBarView.ts    # Shared editor status bar (footer): pipe status, provider, text-host parts
│   │   ├── EditorStatusBar.css       # Status bar styles
│   │   ├── script-panel/
│   │   │   ├── ScriptPanel.ts
│   │   │   └── ScriptPanelView.ts
│   │   ├── secondary-views/         # Native controlled sidebar panel host and registry
│   │   │   ├── SecondaryViewsView.ts
│   │   │   ├── LazySecondaryViewView.ts
│   │   │   ├── SideBarPanelHeaderView.ts
│   │   │   ├── SideBarPanelHeader.css
│   │   │   └── secondary-view-registry.ts
│   │   ├── index.ts
│   ├── content-host/       # File-backed content host (file I/O + encryption)
│   │   ├── TextFileModel.ts           # File-backed content state and collaborators
│   │   ├── TextFileIOModel.ts         # File I/O via content pipes (read/write/watch/cache)
│   │   ├── TextFileActionsModel.ts    # Text actions (duplicate, transform)
│   │   └── TextFileEncryptionModel.ts # Encryption state machine
│   ├── monaco/             # Monaco text editor (text-bearing, content-host trait)
│   │   ├── MonacoEditor.ts           # EditorModel subclass — composes TextFileModel, hosts Monaco
│   │   ├── MonacoBodyView.ts         # Native Monaco body, project binding and per-page diagnostics
│   │   ├── contributions/
│   │   │   ├── translate/            # Text-page translation controller, toolbar, dialog and segmentation
│   │   │   └── transcript/           # Page-scoped capture and Monaco Transcript toolbar contribution
│   │   ├── paste-rich-text.ts         # Rich-text paste handler
│   │   └── index.ts
│   ├── grid/               # JSON/CSV/JSONL grid editor (text-bearing, content-host trait)
│   │   ├── GridEditor.ts             # EditorModel — parsing, sort/filter/edit state
│   │   ├── GridEditorView.ts         # Native page view and toolbar
│   │   ├── GridBodyView.ts            # Native DataGrid integration
│   │   ├── formats/                  # JSON, JSONL, and CSV codecs
│   │   ├── components/               # Grid-specific components
│   │   ├── utils/                    # Grid utilities including grid-format.ts
│   │   └── index.ts
│   ├── markdown/           # Markdown preview (text-bearing, content-host trait)
│   │   ├── MarkdownEditor.ts         # EditorModel — search state, scroll, compact
│   │   ├── MarkdownBodyModel.ts       # Narrow host/model contract shared with embedded guide rendering
│   │   ├── MarkdownSearchState.ts     # Shared find-bar transitions for editor and embedded Markdown
│   │   ├── MarkdownBodyView.ts        # Native body (search, minimap, scroll and host binding)
│   │   ├── MarkdownBlockView.ts       # Reusable markdown rendering (HAST-to-DOM, search + anchors)
│   │   ├── MarkdownBlock.css         # Scoped stylesheet for generated Markdown DOM
│   │   ├── CodeBlock.ts              # Code block + inline Mermaid (+ copyImageToClipboard helper)
│   │   ├── MarkdownImage.ts          # Rendered image + hover toolbar (Copy / Open in new tab)
│   │   ├── hast-dom.ts               # HAST properties and namespace conversion
│   │   ├── rehypeMarkdownOverrides.ts # HAST rewrites for links and task-list inputs
│   │   ├── rehypeHighlight.ts        # Search text highlighting
│   │   ├── rehypeHeadingIds.ts       # Heading slug ids for #fragment links (+ slugifyHeading)
│   │   ├── markdown-nav.ts           # isLocalMarkdownHref — local-.md link detection for in-page nav
│   │   └── index.ts
│   │
│   ├── browser/            # Built-in browser (non-text, no trait)
│   │   ├── BrowserEditor.ts          # EditorModel subclass — registry entry point
│   │   ├── browser-state.ts          # Browser state types, defaults, tab/group IDs, and title policy
│   │   ├── BrowserPromptsModel.ts    # Transient blocked-popup and permission-prompt state
│   │   ├── search-engines.ts         # Search engine definitions and URL detection
│   │   ├── BrowserTabsModel.ts       # Internal tabs, lazy materialization, committed URLs, favicon caches
│   │   ├── BrowserTorModel.ts         # Tor partition and daemon lifecycle
│   │   ├── BrowserProfileNetworkModel.ts # Profile/Incognito proxy: apply before mount, follow settings edits, image route for app-drawn resources
│   │   ├── BrowserEditorView.ts      # Browser editor composition and stylesheet imports
│   │   ├── BrowserToolbarView.ts     # Toolbar and translation controls
│   │   ├── BrowserWebviewItemView.ts # Per-tab webview host and blank-page links
│   │   ├── BrowserPromptBars.ts      # Popup, permission, and site-extension prompts
│   │   ├── SitePermissionsPopover.ts # Site-permission popover content
│   │   ├── PageZoomPopover.ts        # Page zoom popover content
│   │   ├── BrowserWebviewModel.ts    # Private guest registry, readiness, navigation, event routing
│   │   ├── BrowserTestPowerAdoption.ts # Ephemeral runner adoption of existing browser pages
│   │   ├── BrowserStorageState.ts    # Capture/apply browser storage state for tests
│   │   ├── BrowserStorageFacade.ts   # Page local/session storage helpers
│   │   ├── BrowserDownloadCapture.ts # Wait for and resolve a test-page download capture
│   │   ├── BrowserRequestRoutes.ts   # Page-scoped declarative request routes
│   │   ├── BrowserClipboardFacade.ts # Page-scoped clipboard recording and test paste
│   │   ├── page-clipboard-recorder.ts # Page-side copy recorder and scoped paste hook
│   │   ├── BrowserClock.ts           # Page fake-clock registration and controls
│   │   ├── browser-clock-script.ts   # Document-start clock and timer patch
│   │   ├── BrowserSiteExtensionController.ts # Saved/temporary extension selection, injection, actions, and fetch routing
│   │   ├── SiteExtensionInjection.ts  # Shared guarded injection and in-document teardown expressions
│   │   ├── TemporarySiteExtensions.ts # Page-memory test-extension registry, validation, and outcomes
│   │   ├── BrowserPopupModel.ts       # Page-local live popup projection and browser event lifecycle
│   │   ├── BrowserPageLinkOpener.ts   # Opens page-supplied URLs (context menu, target=_blank) under the page-open policy
│   │   ├── BrowserSiteActionsView.ts  # Site action toolbar popover content
│   │   ├── BrowserPageRemote.ts      # Page-authored AiVision/WebMCP registration and requests
│   │   ├── BrowserFindModel.ts       # Find-in-page state and commands
│   │   ├── BrowserShortcutTable.ts   # Browser chrome keyboard shortcut registry
│   │   ├── BrowserTranslationController.ts # Translation workflow and per-tab page translation
│   │   ├── browser-page-menu.ts      # Page menu and Show Resources actions
│   │   ├── BrowserPageTranslationController.ts # Frame-scoped page translation scheduling and results
│   │   ├── webview-context-menu.ts    # Webview context-menu construction
│   │   ├── BrowserUrlBarModel.ts     # URL bar state
│   │   ├── url-display.ts            # URL-bar presentation rules (userinfo, security marker, parts, origin label)
│   │   ├── BrowserUrlDisplayView.ts  # Unfocused URL rendering (host emphasised) and the Not secure chip
│   │   ├── BrowserExclusiveAccessNotice.ts # Fullscreen / pointer-lock notice naming the origin and Esc
│   │   ├── BrowserTargetModel.ts     # Browser automation host for narrow target interfaces
│   │   ├── BrowserTabsPanel.ts        # Native browser tab bar and compact hover preview
│   │   ├── BrowserTabsPanel.css      # Scoped browser-tab presentation
│   │   ├── BrowserView.css           # Scoped browser/webview presentation
│   │   ├── BookmarksDrawer.ts         # Native bookmarks panel
│   │   ├── DownloadButton.ts          # Download indicator
│   │   ├── BrowserDownloadsPopup.ts  # Download list popup
│   │   ├── UrlSuggestionsDropdown.ts  # URL autocomplete
│   │   ├── TorStatusOverlay.ts        # Tor connection status
│   │   ├── BrowserBookmarks.ts       # Bookmarks data management (wraps TextFileModel + LinkEditor)
│   │   ├── BrowserBookmarksModel.ts  # Bookmark resource lifecycle and UI state
│   │   ├── browser-profile.ts        # Browser profile, color, and bookmark-file resolution
│   │   ├── BrowserGuestChannel.ts   # Browser guest IPC and registration keys
│   │   ├── BrowserSitePermissionsModel.ts # Site permissions and certificate actions
│   │   ├── BrowserWebviewReadiness.ts # Per-tab dom-ready and waiter state
│   │   ├── BrowserPanelHost.ts       # IPageHost impl for browser's bookmarks sidebar
│   │   ├── BrowserSecondaryViews.ts   # Native secondary views for blank page and BookmarksDrawer
│   │   ├── browser-search-history.ts # Search history
│   │   ├── network-log-links.ts      # Network log → ILink[] conversion (shell-safe cURL)
│   │   ├── browser-pages.ts          # showBrowserPage / openUrlInBrowserTab — page opening; keeps the browser chunk out of startup
│   │   └── index.ts
│   ├── link-editor/        # Link collection editor (text-bearing, content-host trait)
│   │   ├── LinkEditor.ts             # EditorModel — links, categories, tags, filters
│   │   ├── link-collection.ts        # DOM-free link data, indexes, filtering, serialization, and mutations
│   │   ├── link-importer.ts          # Folder traversal and duplicate-aware link import
│   │   ├── LinkBody.ts               # Native link body and branch ownership
│   │   ├── LinkTreeProvider.ts       # ITreeProvider adapter over LinkEditor state; drag-drop import (files→links, links across windows)
│   │   ├── linkTypes.ts
│   │   ├── link-open.ts              # buildLinkEditorContent — links → .link.json content; dependency-light for the sync openLinks API
│   │   ├── routed-src.ts             # ImageRoute + resolveRoutedSrc — rewrites remote image src → tor-src:// or profile-src:// when the editor is hosted by a Tor or proxied browser page (the app renderer is unproxied); local schemes pass through
│   │   ├── pipe-image-src.ts         # usePipeImageSrc — reads an archive-entry imgSrc through a content pipe into a cached blob URL; every other src shape passes through
│   │   ├── panels/                   # Shared panel components (inline + secondary view)
│   │   │   ├── LinkCategoryPanel.ts         # Categories tree panel
│   │   │   ├── LinkTagsPanel.ts             # Tags list panel
│   │   │   ├── LinkHostnamesPanel.ts        # Hostnames list panel
│   │   │   ├── LinkCategorySecondaryView.ts    # Secondary view wrapper
│   │   │   ├── LinkTagsSecondaryView.ts        # Secondary view wrapper
│   │   │   └── LinkHostnamesSecondaryView.ts   # Secondary view wrapper
│   │   ├── LinksList.ts              # Native/type module
│   │   ├── LinksListView.ts           # Native RenderGrid list renderer
│   │   ├── LinksTiles.ts             # Native/type module
│   │   ├── LinksTilesView.ts          # Native RenderGrid tile renderer
│   │   ├── LinksItemsView.ts          # Shared list/tile item-view implementation
│   │   ├── link-item-actions.ts       # Shared open, favicon, and link context-menu actions
│   │   ├── FaviconRowTracker.ts       # Shared row favicon subscriptions
│   │   ├── LinkFilterNavigationPanelView.ts # Tags/hostnames navigation panel composition
│   │   ├── LinkTooltipView.ts         # Native tooltip content
│   │   ├── PinnedLinksPanelView.ts    # Native pinned-links panel
│   │   ├── EditLinkDialog.ts       # Edit-link dialog model and registration
│   │   ├── EditLinkDialogView.ts   # Native edit-link dialog view
│   │   └── index.ts
│   ├── svg/                # SVG preview (text-bearing, content-host trait)
│   │   ├── SvgEditor.ts              # EditorModel — SVG state
│   │   ├── SvgBodyView.ts             # Native preview body
│   │   └── index.ts
│   ├── html/               # HTML preview (text-bearing, content-host trait)
│   │   ├── HtmlEditor.ts             # EditorModel — HTML state
│   │   ├── HtmlBodyView.ts            # Native sandboxed preview body
│   │   └── index.ts
│   ├── mermaid/            # Mermaid diagram preview (text-bearing, content-host trait)
│   │   ├── MermaidEditor.ts          # EditorModel — SVG URL, loading, error, and per-page look/layout/theme
│   │   ├── MermaidBodyView.ts         # Native preview body
│   │   ├── render-mermaid.ts         # Rendering utilities (shared with Markdown)
│   │   ├── mermaid-options.ts         # Look/layout types, validation, and defaults
│   │   └── index.ts
│   ├── log-view/           # Log viewer (text-bearing, content-host trait)
│   │   ├── LogViewEditor.ts          # EditorModel — entry state, host synchronization, and view coordination
│   │   ├── JsonlLogDocument.ts        # JSONL entry parsing, line count, and ID bookkeeping
│   │   ├── log-entry-types.ts         # DOM-free entry-type registry and derived predicates
│   │   ├── log-entry-view-factories.ts # Entry-type to native view factory registry
│   │   ├── LogBodyView.ts             # Log viewer native view (MeasuredRowGrid + auto-scroll)
│   │   ├── LogEntryWrapper.ts        # Cell root — subscribes to entries[index]
│   │   ├── LogEntryContent.ts        # Type router — dispatches to entry renderers
│   │   ├── LogMessageView.ts          # Log message renderer
│   │   ├── StyledTextView.ts          # StyledText renderer
│   │   ├── logTypes.ts               # LogEntry, StyledText, dialog/output types
│   │   ├── logConstants.ts
│   │   ├── items/                    # Dialog and output entry renderers (15 files)
│   │   └── index.ts
│   ├── env-vars/           # Environment variables editor (text-bearing, content-host trait)
│   │   ├── EnvVarsEditor.ts           # EditorModel — namespace/profile selection
│   │   ├── EnvVarsBodyView.ts         # Native environment-variable grid body
│   │   ├── open-env-vars.ts          # openEnvVarsPage(namespace)
│   │   └── index.ts
│   ├── image/              # Image viewer (non-text, no trait)
│   │   ├── ImageEditor.ts            # EditorModel — pipe-backed image state
│   │   ├── ImageView.ts              # Native page view
│   │   └── index.ts
│   ├── mcp-inspector/      # MCP Inspector (non-text, no trait)
│   │   ├── McpInspectorEditorModel.ts # EditorModel — editor lifecycle and composition of connection and area models
│   │   ├── McpSession.ts             # MCP request timing, connection generations, and stale-request guards
│   │   ├── McpToolsModel.ts         # Tool-list, selection, and call state
│   │   ├── McpResourcesModel.ts     # Resource-list, selection, and read state
│   │   ├── McpPromptsModel.ts       # Prompt-list, selection, and result state
│   │   ├── McpInspectorView.ts        # Main view — connection bar, panel routing
│   │   ├── McpConnectionManager.ts   # MCP SDK Client wrapper
│   │   ├── McpConnectionStore.ts     # Saved connections store (mcp-connections.json)
│   │   ├── ToolsPanel.ts
│   │   ├── ToolArgForm.ts
│   │   ├── ToolResultView.ts
│   │   ├── ResourcesPanel.ts
│   │   ├── ResourceContentView.ts
│   │   ├── PromptsPanel.ts
│   │   ├── mcp-inspector.css
│   │   └── index.ts
│   ├── compare/            # Diff editor (non-text, no trait)
│   │   ├── CompareEditor.ts
│   │   └── index.ts
│   ├── file-diff/          # Git revision diff editor (text-bearing, content-host trait)
│   │   ├── FileDiffEditor.ts         # EditorModel — revision selection and diff state
│   │   ├── FileDiffBodyModel.ts      # Diff content and revision state
│   │   ├── FileDiffBodyView.ts       # Native diff body and Monaco host composition
│   │   ├── FileDiffToolbarView.ts    # Native revision toolbar
│   │   ├── RevisionPickerView.ts     # Native revision picker popover
│   │   ├── GitDiffRevisionsSecondaryView.ts # Native revisions sidebar panel
│   │   └── index.ts
│   ├── about/              # About page (non-text, no trait)
│   │   ├── AboutEditor.ts            # EditorModel
│   │   ├── AboutView.ts               # Version card and split guide-browser layout
│   │   ├── AboutGuideBrowserView.ts   # Guide contents tree and browser state projection
│   │   ├── AboutGuidePageView.ts      # In-pane guide page with breadcrumbs and actions
│   │   ├── AboutView.css
│   │   └── index.ts
│   ├── settings/           # Settings page (non-text, no trait)
│   │   ├── SettingsEditor.ts         # EditorModel
│   │   ├── SettingsView.ts            # Shell-owned headers, panel stack, Content tree, and lifecycle
│   │   ├── SettingsLayoutModel.ts     # Ordered section/group model and selection fallback
│   │   ├── ScrollSpy.ts               # Settings scroll-to-selection and active-section tracking
│   │   ├── settings-catalog.ts        # Built-in groups, section descriptors, row purposes, and stable element names
│   │   ├── settings.css               # Settings page and panel-stack styling
│   │   ├── fields/                    # Store adapters and settings-specific field views
│   │   │   ├── settings-store.ts
│   │   │   ├── CheckboxField.ts
│   │   │   ├── ChoiceField.ts
│   │   │   ├── NumberField.ts
│   │   │   ├── PortField.ts
│   │   │   ├── PathField.ts
│   │   │   ├── ShortcutField.ts
│   │   │   ├── TextListField.ts
│   │   │   └── BoardSettingFields.ts
│   │   ├── sections/                  # Focused settings views + component models
│   │   │   ├── BrowserProfilesSection.ts
│   │   │   ├── BrowserProfilesSectionModel.ts # Profile form, dialogs, bookmarks/network actions, and clear feedback
│   │   │   ├── MicrophoneAudioSection.ts # Microphone status and audio-processing settings
│   │   │   ├── SiteExtensionsSection.ts  # Site-extension folder and installed/trusted summary
│   │   │   ├── ProfileNetworkLineView.ts # Direct / SOCKS5 / HTTP proxy line for a profile, Default, or Incognito
│   │   │   ├── DefaultBrowserSection.ts
│   │   │   ├── DefaultBrowserSection.ts       # Registration status + actions
│   │   │   ├── McpSection.ts
│   │   │   ├── McpSectionModel.ts    # MCP/Mneme status, validation + actions
│   │   │   ├── FileSearchSection.ts
│   │   │   ├── ClipboardSection.ts    # Opt-in clipboard history and item-cap settings
│   │   │   ├── ThemeSection.ts
│   │   │   ├── SettingsSections.ts
│   │   │   ├── BoardSettingsSection.ts # Manifest-declared board controls and reset actions
│   │   │   └── settings-native.ts   # Shared native settings helpers
│   │   └── index.ts
│   ├── storybook/          # Native Storybook editor and component gallery
│   │   ├── StorybookEditorModel.ts   # EditorModel — component browser, live preview
│   │   ├── StorybookEditorView.ts
│   │   ├── ComponentBrowser.ts
│   │   ├── LivePreview.ts
│   │   ├── PropertyEditor.ts
│   │   ├── iconPresets.ts
│   │   ├── story-props.ts            # Shared story prop preparation
│   │   ├── storyRegistry.ts
│   │   ├── renderGridStory.ts        # RenderGrid virtualization story
│   │   ├── storyTypes.ts
│   │   └── index.ts
│   ├── video/              # Video/audio player (non-text, no trait)
│   │   ├── VideoEditor.ts            # EditorModel: playback state, streaming integration, temporary recording lifecycle
│   │   ├── VideoView.ts              # Native editor view
│   │   ├── VPlayer.ts                # Native media and HLS playback view
│   │   ├── video-editor.css           # Static video-editor presentation styles
│   │   ├── NodeFetchHlsLoader.ts     # Custom hls.js loader via nodeFetch
│   │   ├── video-types.ts
│   │   └── index.ts
│   ├── category/           # Category/folder view (non-text, no trait — provider-agnostic)
│   │   ├── CategoryEditor.ts         # EditorModel + native view (single file)
│   │   ├── CategoryEditorModel.ts    # Page model — decodes tree-category:// link
│   │   ├── FolderViewModeService.ts  # Per-folder view mode persistence
│   │   └── index.ts
│   ├── archive/            # Archive editor (non-text, with sidebar panel)
│   │   ├── ArchiveEditor.ts          # EditorModel — archive state, tree provider, navigation survival
│   │   ├── ArchiveEditorView.ts       # Main content view
│   │   ├── ArchiveSecondaryView.ts    # Secondary panel — tree view with native header
│   │   └── index.ts
│   ├── explorer/           # File explorer (non-text, sidebar-only)
│   │   ├── ExplorerEditorModel.ts    # EditorModel — tree provider, selection, search, root navigation
│   │   ├── page-explorer.ts          # Explorer provisioning for a page — toggleNavigator, explicit root, auto-init
│   │   ├── ExplorerSecondaryView.ts   # "explorer" panel — tree view with native header
│   │   ├── SearchSecondaryView.ts  # "search" panel — file search with native header
│   │   ├── index.ts
│   ├── clipboard/          # Clipboard history/sidebar surface
│   │   ├── ClipboardPanelEditorModel.ts # Independent optional "clipboard" panel editor
│   │   ├── ClipboardSecondaryView.ts # "clipboard" view renders ClipboardHistoryModel state
│   │   ├── ClipboardSecondaryView.css # Clipboard panel time/Copy trailing-slot swap styling
│   │   └── clipboard-date.ts          # Local-calendar Clipboard capture time badge and tooltip formatter
│   ├── mneme-config/       # Mneme config & monitoring editor (non-text, no trait)
│   │   ├── MnemeConfigEditorModel.ts # EditorModel — roots, include/ignore, reindex + progress, model, status polling
│   │   ├── MnemeConfigView.ts        # Main view (single page)
│   │   ├── RootsPanel.ts             # Roots + include/ignore + reindex/progress
│   │   ├── ModelPanel.ts             # Embedding-model status + update
│   │   └── index.ts
│   ├── mneme-root/         # Mneme root — search main view + Explorer-like tree sidebar (Pattern B navigation-singleton, per-folder)
│   │   ├── MnemeRootEditorModel.ts   # EditorModel — root resolve, search (text/vector/hybrid), tree state
│   │   ├── MnemeRootEditorView.ts    # Search UI + ranked results
│   │   ├── MnemeTreeSecondaryView.ts # "mneme-tree" sidebar panel (browse/create/rename/delete/drop)
│   │   ├── results-to-markdown.ts    # Render search hits as markdown
│   │   └── index.ts
│   ├── board/              # Board editor, board library/sidebar surfaces (non-text, Pattern B survive-navigation)
│   │   ├── BoardEditorModel.ts       # EditorModel — single-board lifecycle, per-board trust gate, live iframe ref, icon; file/folder sources keep boardRoot separate from filePath/folderPath; busy keep-alive
│   │   ├── board-identity.ts         # Shared shell board display-name, glyph, warm state, and change events
│   │   ├── board-window-identity.ts  # Board-window title and identity IPC lifecycle
│   │   ├── board-tab-title.ts        # Localized board page-tab title formatter
│   │   ├── BoardEditorView.ts        # Native four-way board branch host
│   │   ├── BoardToolbar.ts           # In-board toolbar — File Explorer root selection / board text slot / … menu; hosts board controls
│   │   ├── BoardToolbar.css           # Board-control group styling — separates board items from Persephone's own
│   │   ├── BoardToolbarControls.ts    # Board-declared control catalog — descriptor validation, keyed reconciliation, action events
│   │   ├── chrome/                    # Board chrome protocol validators shared by model and views
│   │   ├── frame/                     # Per-frame session, typed endpoint, router composition, working-folder and other feature bridges
│   │   ├── model/                     # Frame registry, chrome, AiVision, source, page-state, working-folder and content-resource owners
│   │   ├── board-toolbar-icon.ts      # Toolbar icon resolution — registry name, sanitized inline SVG, or a file confined to the board root
│   │   ├── board-file-icons.ts         # Resolves board-requested file names to deduplicated data URLs using Persephone's file-icon resolver
│   │   ├── BoardWebview.ts            # Thin native iframe view; creates and retires its BoardFrameSession
│   │   ├── BoardsPanelEditorModel.ts # Independent optional "boards" panel editor and Explorer-root binding
│   │   ├── BoardsSecondaryView.ts     # Trusted boards and registered toolsets under the Explorer root
│   │   ├── BoardsTreeView.ts         # Reusable native boards tree (single-root + multi-root; folder-compacted; click / trailing / context-menu slots)
│   │   ├── BoardTargetModel.ts       # Board automation host for narrow target interfaces
│   │   ├── board-theme.ts            # computeBoardThemePalette + BOARD_TOKEN_VARS (--p-* contract)
│   │   ├── UntrustedBoardView.ts      # Shown in place of the board iframe when the board is untrusted (Trust board button)
│   │   ├── BoardNotFoundView.ts       # Shown when a board root no longer exists on disk (e.g. stale trusted/pinned path)
│   │   └── index.ts                   # boardModule + native EditorModule factory
│   ├── board-info/         # Board Info editor ("board-info") — install + properties over one host-capable holder
│   │   ├── BoardInfoEditorModel.ts   # EditorModel — install/properties modes; file- or folder-keyed catalog matches; preserves folderPath through Download→Register; adopts/yields CONTENT_HOST_TRAIT without rendering
│   │   ├── BoardInfoEditorView.ts     # Download→Register install UI + properties/versions UI (UIKit only)
│   │   ├── BoardScreenshotView.ts      # Catalog screenshot at a fixed 16:10 footprint — remote <img>, placeholder on no-URL/404; also used by the hub's Search boards tab
│   │   ├── board-info-id.ts          # BOARD_INFO_EDITOR_ID constant (avoids an import cycle with PageToolbarView)
│   │   ├── open-board-info.ts        # openBoardInfo(page,opts) replaces a page's editor; openBoardInfoPage(opts) opens a new page
│   │   └── index.ts
│   ├── tools-hub/          # Tools & Editors hub ("tools-hub-view") — full-page counterpart of the sidebar panel (singleton via fixed PageModel id)
│   │   ├── ToolsHubEditor.ts         # EditorModel — Editors / Search / Tools / Site extensions tabs
│   │   ├── ToolsHubView.ts            # Tab strip and category manager + merged Editors tree layout
│   │   ├── EditorsTreeView.ts         # Built-in root plus trusted boards in one tree
│   │   ├── EditorCategoriesView.ts    # Hub-only category manager
│   │   ├── EditorCategoryColumnListView.ts # Shared category/item column-flow layout
│   │   ├── TrustedToolsListView.ts    # Native trusted-toolset list and owned trailing controls
│   │   ├── creatable-item-icon.ts     # Fresh icon-node factory for creatable items
│   │   ├── SearchBoardsTab.ts         # Published-catalog browse/filter — board cards → Board Info page
│   │   └── index.ts
│   ├── toolset/            # Per-toolset viewer (non-text, no trait) — opened via persephone-toolset://
│   │   ├── ToolsetEditorModel.ts     # EditorModel ("toolset-view") — reads manifest, exposes tool list + log path; restore from toolsetRoot
│   │   ├── ToolsetEditorView.ts       # Native read-only view — manifest info + tool cards
│   │   └── index.ts                   # toolsetModule + EditorModule factory (decodes the link)
│   ├── tools/              # Shared registered-toolsets tree (used by the sidebar Tools panels)
│   │   ├── ToolsTreeView.ts          # Native Tree of toolsets (folder-compacted; open / trailing / context-menu slots)
│   ├── shared/             # Shared editor utilities and Monaco widget hosts
│   │   ├── link-open-menu.ts
│   │   ├── MonacoEditorHostView.ts   # VanillaView host for the single editor; owns file-backed project models
│   │   ├── MonacoEditorHostView.css  # Single-editor host flex geometry
│   │   ├── MonacoDiffEditorHostView.ts # VanillaView host for the diff host
│   │   ├── MonacoDiffEditorHostView.css # Diff-host flex geometry
│   │   ├── ColorizedCodeView.ts      # Native syntax-highlighted code via Monaco colorize()
│   │   ├── monaco-project-intellisense.ts # Project file URIs, extra libraries and file watching
│   │   ├── monaco-project-diagnostics.ts # Page-scoped TypeScript diagnostic markers
│   │   └── FindBarView.ts            # Native browser find bar
│   │
│   ├── register-editors.ts # Editor registration — table-driven (EDITORS rows + loop) + content-host module preload
│   └── types.ts            # View-module prop types (required native EditorModule.View)
│
├── scripting/              # Script Execution
│   ├── script-engine.ts    # Stateless top-level compile/execute heuristics
│   ├── ScriptLibrary.ts    # Lazy transpilation, library registration and cache preparation
│   ├── ScriptRunner.ts     # Orchestrator (context lifecycle, result handling, rejection window)
│   ├── ScriptContext.ts    # Execution scope class (context proxy, cleanup)
│   ├── script-globals.ts   # Ordered script globals and generated execution prefixes
│   ├── AutoloadRunner.ts   # Autoload registration scripts from library/autoload/
│   ├── script-utils.ts     # Utilities (convertToText)
│   ├── transpile.ts        # TypeScript transpilation via sucrase (lazy-loaded)
│   ├── library-require.ts  # Library require() resolution + .ts extension handler
│   ├── worker/             # Background worker execution (app.runAsync)
│   │   └── WorkerRunner.ts # Renderer-side: IPC to main, proxy dispatch
│   ├── api-wrapper/        # Safe wrappers for script access
│       ├── AppWrapper.ts           # Wraps app → IApp (events proxy; compile-time member check)
│       ├── PageCollectionWrapper.ts # Wraps pages → IPageCollection
│       ├── PageWrapper.ts          # Wraps page → IPage; gets editor facades from the registry
│       ├── EditorFacadeBase.ts     # Shared identity, attachment checks, and AiVision descriptor assembly
│       ├── editor-facade-registry.ts # Editor ID to facade factory registry
│       ├── register-editor-facades.ts # Registers facade factories before page lookup
│       ├── AutomationSurface.ts    # Shared script automation dispatch and activity/tip policy
│       ├── LogEntryHandle.ts       # Generic handle for Log View output entries
│       ├── TextEditorFacade.ts     # ITextEditor facade
│       ├── GridEditorFacade.ts     # IGridEditor facade
│       ├── LinkEditorFacade.ts     # ILinkEditor facade
│       ├── BrowserEditorFacade.ts  # IBrowserEditor facade + shared automation members + optional page-authored .app proxy
│       ├── MarkdownEditorFacade.ts # IMarkdownEditor facade
│       ├── AboutEditorFacade.ts     # IAboutEditor facade (guide-browser navigation and elements)
│       ├── SvgEditorFacade.ts      # ISvgEditor facade
│       ├── HtmlEditorFacade.ts     # IHtmlEditor facade
│       ├── MermaidEditorFacade.ts  # IMermaidEditor facade
│       ├── VideoEditorFacade.ts    # IVideoEditor facade (playback and media state)
│       ├── FileDiffEditorFacade.ts # IFileDiffEditor facade (revision state)
│       ├── BoardEditorFacade.ts    # IBoardEditor facade (metadata, trust state, automation, panels, conditional .app proxy, reload)
│       ├── board-editor-facade-definitions.ts # Board facade descriptors and member definitions
│       ├── BoardInfoEditorFacade.ts # IBoardInfoEditor facade (install/properties state)
│       ├── ToolsetEditorFacade.ts  # IToolsetEditor facade (registered toolset state/actions)
│       ├── ToolsHubEditorFacade.ts # IToolsHubEditor facade (hub tab state)
│       ├── MnemeConfigEditorFacade.ts # IMnemeConfigEditor facade (configuration/status/actions)
│       ├── MnemeRootEditorFacade.ts # IMnemeRootEditor facade (search state/actions)
│       ├── UiFacade.ts             # Log View UI (logging + dialogs + output)
│       └── StyledTextBuilder.ts   # Fluent styled text builder + styledText() factory
│   └── ai-vision/           # Renderer AiVision root, call/attention entry points, event log, and descriptors
│       ├── dialogs/         # ViewId-keyed adapters for renderer dialogs
│       ├── menus/           # Popup-menu adapter and indexed menus node
│       ├── namespaces/      # App namespace descriptors, including events, boards, and Agent Tools
│       │   ├── boards.ts    # Local board inventory and published-catalog namespace
│       │   ├── events.ts    # Retained event reads and bounded cursor-based waits
│       │   ├── tools.ts     # Registered Agent Tools search, execution, toolsets, and unregistration
│       │   ├── ui-elements.ts # Curated shell-control declarations
│       │   ├── ui-guide.ts  # Blocking one-control-at-a-time walkthroughs
│       │   └── index.ts     # Namespace registration and descriptor wiring
│       ├── event-log.ts     # Per-window event ring and producer helpers, including alert-raised events
│       ├── alert-watch.ts   # Forwards new error/warning toasts into the renderer event log
│       ├── attention.ts     # Renderer call attention, including once-per-renderer inline Log View dialog notices
│       ├── page-attention.ts # Agent-addressed page tracking and activation suppression
│       ├── page-activation.ts # Mount-scoped active-page observer and event producer
│       ├── root.ts          # Renderer object-model root
│       ├── page-compare.ts  # pages.compare pair projection and controls
│       └── page-panels.ts   # pages[i].editor.panels projection and controls
│
├── automation/             # Browser-like automation used by Object Model call paths
│   ├── types.ts            # Narrow target seams: automation, synthetic input, navigation, and tabs
│   ├── CdpSession.ts       # CDP session wrapper (IPC to main process debugger)
│   ├── snapshot.ts         # Accessibility snapshot (main frame + iframes, overlay detection)
│   ├── selector-execution.ts # Single host entry for page-side selector candidate execution
│   ├── page-scripts.ts     # resolveCandidates: one selector grammar plus visibility/frame snippets
│   ├── locator-reads.ts    # Strict locator reads and bulk field capture
│   ├── wait-for-function.ts # Serialized page predicate polling and deadlines
│   ├── context-loss.ts     # Navigation/context-loss classification
│   ├── json-value.ts       # JSON-safe automation values
│   ├── input-session.ts    # CDP input session and shared frame-coordinate mapping
│   ├── locator.ts          # Actionability and locator action resolution
│   ├── mouse.ts            # Locator click, hover, and drag orchestration
│   ├── pointer-actions.ts  # Low-level pointer actions, state, and dispatch
│   ├── keyboard.ts         # Key actions and modifier mapping
│   ├── forms.ts            # Text, select, checkbox, and file input operations
│   ├── queries.ts          # Evaluate, query, and wait operations
│   ├── page-events.ts      # Readiness, page events, dialogs, console, and errors
│   ├── navigation.ts       # Navigation and response waits
│   ├── page-state.ts       # Screenshots, viewport, and network state
│   ├── synthetic.ts        # Explicit legacy synthetic input compatibility path
│   ├── input.ts            # Legacy input strategy implementation used by synthetic.ts
│   ├── ref.ts              # Per-host ref/frame-session stores and ref resolution
│   ├── AppTargetModel.ts   # App-window automation target (pageId "app")
│
├── uikit/                  # UIKit — standalone component library
│   │                       # Canonical home for reusable primitives. Must not import from
│   │                       # api/, ui/, editors/, or app-specific code. Authoring rules
│   │                       # live in uikit/CLAUDE.md. See uikit-vs-components-split.md
│   │                       # for the permanent contract.
│   ├── CLAUDE.md           # UIKit authoring rules (canonical reference)
│   ├── Button/             # Button
│   ├── IconButton/         # Icon-only button (also: chip variant)
│   ├── SplitButton/        # Primary action + caret dropdown menu (composes IconButton + WithMenu)
│   ├── Input/              # Text input
│   ├── Textarea/           # Multi-line text input (contentEditable, auto-grow)
│   ├── Checkbox/           # Checkbox
│   ├── Switch/             # Controlled accessible on/off switch
│   ├── RadioGroup/         # Radio group
│   ├── Select/             # Single-select dropdown (replaces ComboSelect)
│   │   └── SelectProps.ts   # Select-owned props separated from native root props
│   ├── MultiSelect/        # Multi-select dropdown (replaces ListMultiselect)
│   ├── Autocomplete/       # Autocomplete combobox
│   ├── PathInput/          # File/folder path input with picker
│   │   └── PathInputProps.ts # PathInput-owned props separated from native root props
│   ├── SegmentedControl/   # Segmented switch (replaces SwitchButtons)
│   ├── Slider/             # Range slider
│   ├── ProgressBar/        # Linear progress
│   ├── Spinner/            # Indeterminate circular progress (replaces CircularProgress)
│   ├── Tag/                # Tag/chip pill (replaces Chip)
│   ├── TagsInput/          # Tag-editing input
│   ├── Label/              # Form label
│   ├── Text/               # Text element with theme styling
│   ├── TruncatedText/      # Overflow-ellipsis with hover title (replaces OverflowTooltipText)
│   ├── Breadcrumb/         # Breadcrumb path navigation
│   ├── Panel/              # Flex container (props-driven layout)
│   ├── ImageViewport/      # Reusable zoom/pan image preview with clipboard copy
│   ├── Spacer/             # Flex spacer (replaces FlexSpace)
│   ├── Divider/            # Horizontal or vertical divider
│   ├── Dot/                # Status dot indicator
│   ├── CollapsiblePanelStack/ # Stacked collapsible panels
│   ├── Splitter/           # Resizable splitter
│   ├── Toolbar/            # Toolbar container (roving tabindex internally)
│   ├── Minimap/            # Mini map navigation overlay
│   ├── CategoryList/       # Category-style list
│   ├── ListBox/            # Virtualized list with selection + traits (replaces List)
│   ├── MultiListBox/       # Two-pane multi-select list
│   ├── Tree/               # Virtualized tree with controlled expansion, explicit repaintSignal, and trait drag-drop (replaces TreeView)
│   ├── Menu/               # Portal menu + WithMenu wrapper (replaces PopupMenu)
│   ├── Popover/            # Portal-based floating element with required native contentView (replaces Popper)
│   ├── Tooltip/            # Hover tooltip
│   ├── HelpIcon/           # Focusable question-mark help with tooltip and accessible description
│   ├── Dialog/             # Modal dialog
│   ├── Notification/       # Alert / toast notification state, views, and AlertsBar
│   ├── Progress/           # Progress overlay + screen lock
│   ├── DataGrid/            # av-grid boundary: RenderGrid, MeasuredRowGrid, and data-grid mounting
│   └── shared/             # Internal helpers (overlay layer, focus restoration, native slots, and view lifecycle)
│       ├── vanilla-view.ts # Framework-free view lifecycle, ownership, IMountableView, binding, and cleanup
│       ├── keyed-list.ts   # Keyed DOM reconciliation with minimal cursor moves
│       ├── subtree-swap.ts # Owned conditional subtree replacement
│       ├── repaint-tracker.ts # Row/global/local prop identity diff for virtualized repaint decisions
│       ├── pooled-row-host.ts # Shared RenderGrid wrapper pool and retained row-view lifecycle
│       ├── list-shell-arms.ts # Loading, empty, and real-list shell transitions
│       ├── deps-gate.ts    # Fixed-length repaint/dependency identity gate
│       ├── element-id.ts   # Shared DOM id allocation for generated elements
│       ├── fill-slot.ts    # Native slot-content filling and generation-safe cleanup
│       ├── dom-props.ts    # Native attributes/events, typed prop splitting, DOM-attribute helpers, and listener cleanup
│       ├── list-filter.ts  # Shared list-label matching and parallel item/source filtering
│       ├── list-navigation.ts # Shared list keyboard movement with explicit clamp/wrap options
│       ├── focus-restore.ts # Marks synchronous focus restoration so focusin consumers can ignore it
│       ├── drop-target-tracker.ts # Nested drag-target counts and scheduled hover lifecycle
│       └── slots.ts        # Neutral icon and slot-content types/resolution
│
├── components/             # Persephone-Coupled Components (KEEP-only)
│   │                       # Each remaining folder uses app.* APIs, page model, file
│   │                       # system, or scripting — that's the criterion. No new pure
│   │                       # primitives go here.
│   ├── tree-provider/      # TreeProviderView and CategoryView native views over any ITreeProvider
│   │   ├── TreeProviderView.ts # Native tree chrome and UIKit Tree wiring
│   │   ├── TreeProviderViewModel.ts # Controlled expansion, search projection, selection, actions, and drops
│   │   ├── provider-tree-store.ts # Provider tree builds, expanded-child listing, and serialized watch refresh
│   │   ├── provider-tree-watch-controller.ts # Provider watch wiring and serialized refresh application
│   │   ├── provider-tree-folder-watches.ts # Watch subscriptions for the visible, effectively expanded folders
│   │   ├── provider-tree-expansion.ts # Saved paths and normal/deep-search expansion state
│   │   ├── tree-provider-node.ts # Provider tree node transforms and lookup helpers
│   │   ├── tree-search-filter.ts # Search matching and display-tree filtering
│   │   ├── CategoryView.ts # Native folder-content view and bounded editor island
│   │   ├── CategoryViewModel.ts # Folder listing, selection, actions, and drops
│   │   ├── provider-item-controller.ts # Shared CRUD/menu/key/drag actions for both provider-backed views
│   │   ├── os-clipboard.ts  # OS file-clipboard actions (Cut/Copy/Paste ⇄ Windows Explorer) shared by the tree + category view models; file provider only
│   │   ├── plural-actions.ts # Set-shaped actions shared by the tree + folder page: the multi-select gate, nested-item pruning, the plural menu, batch delete
│   │   ├── item-crud-actions.ts # Shared create/rename/delete/paste operations and refresh handling
│   │   ├── item-menus.ts # Shared single-item and background menu construction
│   │   ├── drop-dispatch.ts # Trait payload to provider-level move/import action resolution
│   │   ├── href-utils.ts # Case-insensitive selection and normalized href helpers
│   │   └── tree-drop-actions.ts # Move/import drop actions, taking a { path, title } target rather than a tree node so both views can call them
│   ├── file-search/        # FileSearch native view and prop/state types; virtualized results
│   │   ├── FileSearch.ts  # File-search prop/state types
│   │   ├── FileSearchView.ts # Native search view and pooled result host
│   │   └── FileSearchRowView.ts # FileSearch-specific pooled result row
│   ├── file-list/          # FileList.ts core/model + FileListView.ts native flat list
│   ├── roots-tree-build.ts # Shared compacted tree builder for board and toolset roots
│   ├── file-grid/          # FileGrid.ts types + FileGridView.ts native DataGrid/av-grid list
│   ├── icons/              # Builder-backed Icon face, DOM icon resolvers, and board icon cache/glyph
│   ├── page-manager/       # Native app-page and browser internal-tab hosts
│   │   ├── SplitLayout.ts  # Split-pane ratio, sizing and positioning
│   │   └── GroupContainer.ts # Group host composed with the shared UIKit SplitterView
│   └── git-tree/           # GitTreeView.ts native history view and git submodels
│
├── core/                   # Core Infrastructure
│   ├── startup-environment.ts # Synchronous profile data-folder and appSettings.json reader
│   ├── native-css-properties.ts # Native CSS property type contract shared with UIKit
│   ├── state/              # State management primitives
│   │   ├── MainSnapshotMirror.ts # Revision-guarded renderer mirror for main-owned snapshots
│   │   ├── state.ts        # TOneState, TComponentState, TGlobalState
│   │   ├── dispatch.ts      # Module-global after-dispatch boundary
│   │   ├── listener-list.ts # Shared listener registration and dispatch core
│   │   ├── model.ts        # TModel, TDialogModel, TComponentModel, createComponentModelDriver
│   │   ├── ComponentQueue.ts # Model-to-view event and request/reply mailbox
│   │   └── events.ts       # Emitter/Event primitive and named Subscription broadcasts
│   ├── traits/             # Trait system — drag-and-drop type negotiation
│   │   ├── traits.ts       # TraitKey<T>, TraitSet, Traited<V>, traited(), isTraited()
│   │   ├── TraitRegistry.ts # TraitRegistry singleton + TraitTypeId enum
│   │   ├── dnd.ts          # setTraitDragData, getTraitDragData, hasTraitDragData, resolveTraits; host-drag nonce
│   │   ├── fileLinkTraits.ts # FILE_LINK trait definition and OsFile payload shape
│   │   ├── linkTraits.ts    # ILink trait definition (LINK + FILE_LINK)
│   │   └── index.ts        # Public exports
│   ├── utils/              # Utility functions
│   │   ├── utils.ts        # General helpers
│   │   ├── text-encoding.ts # Shared decodeBuffer/encodeString codec used by fs and content pipes
│   │   ├── DisposableStore.ts # Function/object cleanup ownership, child stores, and ordered cleanup
│   │   ├── scheduling.ts   # OwnerScheduler, Delayer, and paint-boundary scheduling helpers
│   │   ├── echo-guard.ts   # Bounded exact-value self-write echo guard
│   │   ├── parse-utils.ts  # JSON/JSON5 parsing, tryParseJson fallback
│   │   ├── guard.ts        # guard(label, fn) — run and report failure as a toast
│   │   ├── csv-utils.ts    # CSV parsing/generation
│   │   ├── html-resources.ts  # HTML resource extraction (cheerio)
│   │   ├── file-path.ts    # Archive-aware path utility (wraps ALL path.* usage)
│   │   ├── path-utils.ts   # Markdown link resolution
│   │   ├── language-mapping.ts  # Extension → Monaco language
│   │   ├── monaco-languages.ts  # Monaco language config
│   │   ├── focus-utils.ts       # isFocusInSidebar() — editors skip mount/navigation autofocus while focus is in a sidebar panel
│   │   ├── types.ts             # Type helpers
│   │   └── index.ts
│
├── theme/                  # Styling
│   ├── tokens.ts           # Design tokens (spacing, sizing, radius, fontSize, gap, height)
│   ├── color.ts            # Color tokens (CSS custom properties)
│   ├── global-styles.ts    # Native theme-dependent global stylesheet
│   ├── icons.ts             # SVG icon DOM builders and builder contract
│   ├── icon-registry.ts    # Single-source-of-truth names for registered SVG icons
│   ├── language-icons.ts   # Language-specific DOM-built icons
│   ├── palette-colors.ts   # Color palette definitions
│   ├── style-layers.css    # Shared cascade-layer order for static CSS
│   ├── root.css            # Static #root geometry, before renderer mount
│   ├── theme-state.ts      # Shared active-theme snapshot and subscriptions
│   ├── token-vars.ts       # App token CSS-variable generation and installation
│   ├── custom-theme-catalog.ts # Shared sync/async custom-theme file catalog and validation
│   ├── custom-theme-types.ts # Saved theme schema and color derivation types
│   ├── custom-theme.ts     # Custom theme validation, derivation, forking, and contrast reports
│   ├── custom-theme-palette.ts # Per-token derivation recipes
│   ├── color-math.ts       # OKLCH color operations and contrast measurements
│   ├── theme-color-vars.ts # Color variable contract used by built-ins and custom themes
│   └── themes/             # Eight built-in themes, registry, startup loading, and color resolution
│
├── types/                  # Global Type Declarations
│   ├── window.d.ts         # Window interface extension
│   ├── events.d.ts         # MouseEvent extension
│   └── vite-env.d.ts       # Vite import.meta.env declarations
│
└── index.ts                # mount(container): application composition root
```

### Renderer registry and service modules

The renderer API service table lives in `/src/renderer/api/app-service-registry.ts`; the root
`App` class loads each descriptor and invokes its optional initializer. `app.capabilities` lives
under `/src/renderer/api/capabilities/`: `CapabilitiesClient.ts` exposes the script API,
`open-dispatch-server.ts` handles the typed main-to-renderer open RPC, and the sibling handler,
validator, board-dispatcher, board-frame adapter and index-mirror modules own renderer-side work. Provider resolution,
authorization, limits and invocation dispatch are owned by main's `CapabilityClient` and
`CapabilityRouter`. The script contract is typed by
`/src/renderer/api/types/capabilities.d.ts`.

The content directory has three registry-facing modules: `registry.ts` owns provider and
transformer factories, `scheme-registry.ts` owns platform/script URL-scheme hooks, and
`builtin-schemes.ts` installs the platform scheme implementations. `parsers.ts` and
`resolvers.ts` are the event-pipeline adapters around those registries.

## Main Process Structure

`ui-preferences.ts` is the main-process owner for the small scalar preference JSON file under
`<userData>/data`; renderer access is provided through the typed IPC layer.

```
/src/main/
├── main-setup.ts           # Application setup and window creation
├── test-mode/              # Windowless test controller, child-instance options, starter-suite initialization, test-mode logging, browser-download destination, HTTPS trust, and fake media switches with optional WAV capture
│   ├── certificates.ts     # Exact SHA-256 fingerprint allowlist for owned test-instance certificate errors
│   ├── init-suite.ts       # Copies the offline starter suite without overwriting existing files
│   └── media-capture.ts    # Fake media switches and optional file-backed audio input for test instances
├── main-services.ts        # Ordered app-level service startup, phase boundaries, and reverse disposal
├── capability-client.ts    # Per-caller-owner capability list/get/invoke client
├── capability-router.ts    # Main capability resolution, authorization, limits and dispatch
├── capability-backend.ts   # Backend interface for capability method dispatch
├── board-service-backend.ts # Board-service capability adapter
├── audio-backend.ts        # Audio capability adapter
├── json-file-store.ts       # Validated JSON persistence with serialized atomic writes
├── renderer-rpc.ts          # Typed main-to-renderer RPC client, cancellation and request lifecycle
├── application-profile.ts  # Profile argument validation and main-process profile identity
├── windows-env.ts          # Windows env backfill — reconstructs missing standard folder/system vars (APPDATA, LOCALAPPDATA, ProgramFiles*, …) at startup so child processes get a full env even when the app was launched from a degraded shell; win32-only, backfill-only
├── open-window.ts          # Window creation and composition of per-window collaborators
├── window-platform-policy.ts # Compositor-aware window readiness and bounds persistence policy
├── voice-typing-controller.ts # Per-window voice-typing shortcuts, session state and captured-target text insertion
├── open-windows.ts         # Multi-window management and broadcasting
├── global-mute-service.ts  # Main-owned mute leases and effective audio state across managed application contents
├── window-states.ts        # Window state persistence
├── pipe-server.ts          # Platform-specific instance endpoint (launcher integration)
├── mcp-http-server.ts      # Public MCP HTTP policy and listener lifecycle; sessions use the shared MCP host
├── routed-fetch-protocol.ts # Shared parser and simple routed-fetch handler for Tor/profile schemes
├── board-manifest-reader.ts # Main-owned normalized board manifest reader and mtime cache
├── board-snapshot-broadcaster.ts # Publishes one full board snapshot to renderer windows
├── board-trust-store.ts    # Persisted trusted-board grant store
├── board-trust-snapshot-builder.ts # Pure derivation of service and browser-claim snapshots
├── board-trust-subscribers.ts # Wires trust snapshots to main-process consumers and snapshot publication
├── board-file-access.ts    # Board file-access grants, sessions and authorization
├── mcp/private-session-endpoints.ts # Lazy loopback MCP listener and revocable per-service bearer endpoints for private agent sessions
├── mcp/                    # MCP server logic and transport-session collaborators
│   ├── server-factory.ts   # createMcpServer() — assembles manifest + tool groups + guide resources
│   ├── mcp-session-host.ts # Shared transport-session lifecycle, host checks, and body parsing
│   ├── manifest.ts         # Server identity, client instructions, guide resource list, mtime-cached guide reader
│   ├── register-tools.ts   # Generic registrar + the pass-through that implements most tools
│   ├── sdk.ts              # Lazy MCP SDK + zod loader (loadSdk / requireSdk)
│   ├── tool-results.ts     # Response → MCP content mappers (text, page content with image, screenshot)
│   ├── types.ts            # IMcpToolDef and friends
│   ├── tools/              # Advertised tool definitions — call, the whole manifest
│   └── ai-vision/          # Main-process AiVision roots, service descriptors, and gated main scripting
├── browser-service.ts      # Browser composition and IPC-facing service surface
├── media-grants.ts         # One-shot recording, voice-typing, transcript and audio-window grant instances
├── one-shot-frame-grant.ts # Reusable one-shot grant lifecycle and optional frame binding
├── site-permission-store.ts # Persistent profile decisions and in-memory private-session decisions
├── file-system-access-policy.ts # Browser File System Access rule: sensitive-path blocklist, same-origin requester, prompt data
├── browser-service-composition.ts # Injects shared guest lookup into browser/CDP/network services
├── browser/                # Browser guest registration and per-guest policies
│   ├── BrowserGuestRegistry.ts # Key/WebContents lookup and guest registration ownership
│   ├── BrowserPopupRegistry.ts # Real popup ownership, metadata, events, and teardown
│   ├── browser-popup-service.ts # Sender-validated popup close, teardown, focus, and text operations
│   ├── BrowserGuest.ts     # Per-registration listeners, state, and disposal
│   ├── navigation-scheme-guards.ts # Scheme guards for guests (attached at creation) and popups; rules in shared/browser-navigation-policy.ts
│   ├── popup-policy.ts     # Popup window options (size clamp, origin title) and nested-popup admission
│   ├── popup-gate.ts       # Gesture + rate-limit gate for page-opened tabs/windows; per-tab "Allow popups" origin grant
│   ├── user-activation.ts  # Recent user gesture of a guest (consumed by opens, downloads, hand-offs)
│   ├── unload-guard.ts     # Async beforeunload confirm; replays the recorded navigation intent on Leave
│   ├── page-dialog-guard.ts # One JS dialog box at a time per page (replaces Electron's -run-dialog handler)
│   ├── download-request-limiter.ts # One automatic download per document; more need a gesture
│   └── browser-page-guard-service.ts # IPC entry: "Allow popups" grant and host navigation intents
├── browser-dom-snapshot.ts # DOM and loaded-resource collection for browser guests
├── host-fullscreen-controller.ts # Per-window host fullscreen intent and guest coordination
├── preload-webview.ts      # Browser guest preload entry point
├── preload-webview/
│   └── chrome-shim.ts           # Guest window.chrome compatibility shim
│   ├── notification-click.ts    # Forwards guest notification-click events through shared observer
│   └── page-reporters.ts        # Guest title, favicon, input, find, and image messages
│   └── exclusive-access-reporter.ts # Every frame: reports pointer lock to the host
│   └── webmcp-bridge.ts         # Guest WebMCP bridge
│   └── page-translation-agent.ts # Guest-frame text discovery, mutation tracking, and reversible translated DOM updates
├── browser-registration.ts # Default browser registration orchestration
├── linux-desktop-entry.ts  # Linux desktop-entry Exec/value serialization and app invocation
├── linux-browser-registration.ts # Linux default-browser handler and XDG association management
├── linux-executable-lookup.ts # Linux executable discovery on PATH
├── linux-board-shortcut.ts # Verified Linux board .desktop launcher creation
├── ipc-sender-guard.ts     # Shared authorization for every ipcMain registration; accepts only the app's live main frame
├── html-preview-protocol.ts # Isolated html-preview:// origin, folder-confined sibling resources, and per-preview storage cleanup
├── sidecar-process.ts      # Shared sidecar lifecycle (spawn → stdout-readiness sentinel → stop) used by tor-service and mneme-service: start dedupe, readiness timeout, stale-child guard, unexpected-death callback, stop-and-wait before respawn
├── tor-service.ts          # Tor concerns on top of sidecar-process: per-partition SOCKS5 proxy (fail-closed arming), torrc generation, restart-based reconnect, exit-IP/geo lookup through the partition's session
├── session-proxy.ts        # Shared session proxy primitives (one proxy, no direct fallback; set direct; geo lookup) for Tor and profile networks
├── browser-network-service.ts # Profile/Incognito proxy state, profile-src:// policy setup, guest WebRTC policy, egress check, session-src hand-off
├── tor-src-protocol.ts     # tor-src:// scheme policy setup — fetches through a Tor partition session; guarded by partition shape and live-partition check
├── git-service.ts          # Git access via simple-git — status, stage/unstage/commit, branch/switch, fetch/push/pull, ahead-behind, log/show, --version probe — main-process only
├── download-path-queue.ts  # One Save dialog at a time per page, bounded queue
├── download-service.ts     # Browser downloads stage in temp (paused at 32 MB) while an async Save As dialog is open; test instances save under test-mode/test-downloads; completed files receive Mark-of-the-Web from the final redirect URL
├── download-capture.ts     # Armed test-page downloads saved under a temporary capture root for run-folder collection
├── session-src-protocol.ts # Short-lived URL-bound capability; reuses routed URL parsing and enforces board network policy/DNS pinning per redirect hop
├── native-dialog-tracker.ts # Per-window native dialog state, attention snapshots, and helper-backed cancellation
├── search-service.ts       # File search host — owns one search-worker thread per sender window, relays its batches to the renderer; cancel/window-close is worker.terminate()
├── search-worker.ts        # File search walk — runs in a worker_thread (bundled separately to .vite/build/search-worker.js); never imports electron
├── worker-host.ts          # Worker thread host for app.runAsync (IPC + worker_threads)
├── command-runner.ts       # Streaming command runner — spawns child processes, streams stdout/stderr/exit over IPC by jobId; shared by app.proc.execute and the board bridge's execute(); whole-tree kill via taskkill; jobs carry an optional caller-chosen name + a getJobsBySinkIds query (board job re-association)
├── board-protocol-service.ts # board:// scheme handler — host→board-root registry; serves board files + CSP; injects --p-* palette, boot context, and the bridge shim into served HTML
├── board-log.ts              # Single main-owned ui.log path resolver and serialized writer; bounded at 256 KiB with tail trimming
├── board-pipe-service.ts     # Main-side board pipe page/resource ownership and renderer range request correlation
├── board-pipe-range-reader.ts # Validates board-pipe ranges and reads bounded continuations for protocol and video-stream callers
├── board-file-access.ts     # Persisted/session file grants and authorization through shared path containment
├── board-bridge.ts         # Composition root for board ports, connection/retention owners, and RPC domains
├── board-host/              # Main-side board host lifecycle and MessagePort collaborators
│   ├── BoardHostService.ts  # Board mount/theme/port/frame lifecycle orchestration for IPC handlers
│   ├── BoardFrameRegistry.ts # Mounted-frame identity and metadata used by dialogs, CDP and board pipes
│   ├── BoardBridgeConnection.ts # Per-port watches, capability client, TypeScript projects, cursors, watchdog and disposal
│   ├── BoardBridgeConnections.ts # Live connection index, host teardown, watch reservations and load reporting
│   ├── BoardJobRetention.ts # Busy-owner job retention and per-sink/owner/host reaping
│   └── rpc/                 # Typed RPC composition, dispatch/errors, and app/files/watch/services/capabilities/storage domains
├── native-dialogs.ts       # Shared native open/save/folder dialog implementations used by IPC and board handlers
├── board-trust-service.ts # Main owner of trust mutations, refresh, current snapshots and subscriptions
├── module-service-supervisor.ts # Thin facade for service lifecycle, requests, channels, trust, status, and teardown
├── module-service/          # Main-process module-service collaborators
│   ├── process.ts           # One spawned generation: fork, handshake, message dispatch, logging, and exit
│   ├── trust-directory.ts   # Trusted-service snapshot and indexed provider lookup
│   ├── channel-broker.ts    # Direct/capability channel delivery and cleanup
│   ├── board-settings-adapter.ts # Renderer-backed service settings requests and subscriptions
│   ├── capability-client-adapter.ts # Service capability client requests
│   ├── mcp-endpoint-adapter.ts # Private MCP endpoint issuance
│   ├── record.ts            # Per-service state and request/lease/channel records
│   ├── leases.ts            # Per-WebContents renderer MessagePort lease lifecycle
│   ├── restart-budget.ts    # Sliding-window service failure count and bounded restart policy
│   └── storage.ts           # Adapter routing utility-process storage requests through the main board store
├── board-storage.ts        # Main-owned per-board JSON store under data/board-storage/<root-hash>, sidecar metadata, validation and per-board mutation queue
├── cdp-service.ts          # CDP composition and target routing for call-path automation
├── cdp/                    # Per-WebContents CDP target and feature owners
│   ├── CdpTarget.ts        # Debugger lifecycle, enabled domains, and event dispatch
│   ├── cdp-browser-test-methods.ts # Test-power CDP handlers and attach/detach lifecycle wiring
│   ├── cdp-init-scripts.ts # Per-target document-start script registration
│   ├── cdp-storage-state.ts # Cookie state capture and application
│   ├── cdp-request-routes.ts # Page-scoped Fetch request interception
│   ├── cdp-page-events.ts  # Dialog policy and page event state
│   ├── cdp-waits.ts        # Navigation and response wait lifecycle
│   ├── cdp-network-collector.ts # Per-target network response collection
│   ├── cdp-drag-intercept.ts # Drag interception lifecycle
│   └── cdp-ai-vision-binding.ts # Browser AiVision CDP binding lifecycle
├── mneme-service.ts        # Mneme concerns on top of sidecar-process: port/config wiring and MnemeStatus broadcasts for the knowledge-base service
├── snip-service.ts         # Screen snip (spawns the platform-named helper, reads PNG from stdout; exports getSnipToolPath for clipboard services)
├── recording-service.ts    # Per-webContents video recording files, ordered chunk writes, permission grants, and seven-day cleanup
├── clipboard-service.ts    # Opt-in clipboard history — shared storage and available platform capture backend
├── clipboard-history-persistence.ts # Clipboard history payload/index persistence
├── clip-service.ts         # Platform dispatch for file clipboard read/write
├── clip-service-linux.ts   # Linux text/uri-list and GNOME cut/copy file clipboard interop
├── clip-service-windows.ts # Windows file clipboard (CF_HDROP) via snip executable
├── os-drag-service-linux.ts # Linux native file drag-out via Electron startDrag
├── version-service.ts      # Version checking (runs in main, not renderer)
├── published-boards-service.ts # Published-boards catalog — net.fetch raw boards-manifest.json (24h-gated, cached, isSafeBoardId/isSafeAssetName-guarded), getBoardVersions(id) on demand, ePublishedBoardsUpdated broadcast; screenshotUrl derived on the way out (never cached); PERSEPHONE_BOARDS_BRANCH dev override
├── board-download-service.ts # Streamed board-archive download — net.fetch → temp file + incremental sha256 verify, throttled eBoardInstallProgress, digest check
├── video-stream-server.ts  # Local HTTP streaming server (shared range handling, faststart MP4 relocation, session management)
├── vlc-launcher.ts         # VLC process launcher (spawn + auto-detect VLC path)
├── terminal-launcher.ts    # Platform-dispatched terminal launcher for "Open Terminal here"
├── linux-terminal-launcher.ts # Linux terminal detection and working-directory command launch
├── desktop-awareness-linux.ts # Linux session-lock polling
├── tray-availability-linux.ts # Linux StatusNotifier host probe for tray and close-to-tray availability
├── tray-setup.ts           # System tray
├── drag-model.ts           # Tab drag between windows
├── e-store.ts              # Electron store wrapper
├── dialog-folder-memory.ts # Last-used folder per native dialog kind (open/save/folder), persisted in electronStore under dialog.lastDir.<kind>; resolveDefaultPath applies the precedence, rememberDirFromPick records a completed pick
├── fileIconCache.ts        # File icon caching
├── constants.ts            # Main process constants
└── utils.ts                # Main process utilities
```

## IPC Layer

All main-process `ipcMain` registrations must pass through the shared sender guard in
`src/main/ipc-sender-guard.ts`. Use `guardedIpcOn` / `guardedIpcHandle` for event and invoke
handlers, or register typed API endpoints with `bindEndpoint` / `bindDomain` in
`main/endpoint-registry.ts`, which use the same guard. The renderer request client and main
registrars derive their signatures from the shared domain contracts. Do not add a direct,
unguarded `ipcMain` listener or handler.

```
/src/ipc/
├── contracts/              # Domain request signatures, event payloads, and endpoint-specific timeout exemptions
│   ├── app.ts              # Application APIs and lifecycle event contracts
│   ├── boards.ts           # Board lifecycle, bridge, automation, and catalog APIs/events
│   ├── window.ts           # Window and display APIs/events
│   └── ...                 # Audio, files, capabilities, Git, module services, and other domains
├── api-types.ts            # Composes domain contracts into Api and EventApi
├── api-param-types.ts      # Shared IPC parameter types
├── event-types.ts          # Event payload types derived from EventApi
├── preload-channels.ts     # Preload allowlist for IPC channel and port operations
├── board-bridge/           # Board boot context, port wire types, frame envelopes, UI catalogs, and origin routes
├── board-snapshot-channels.ts # Full board snapshot event, pull, and wire types
├── browser-network-ipc.ts  # BrowserNetwork type, proxy validation, browser-network channels
├── browser-translation-messages.ts # Typed host/guest translation messages and frame-scoped unit DTOs
├── browser-guest-messages.ts # Typed guest-to-host browser messages
├── runner-channels.ts      # Streaming command-runner channels and wire types
├── module-service-channels.ts # Main/utility-process service protocol and lifecycle wire types
├── ...                     # Other standalone protocols and domain channels
├── main/                   # Main-process IPC composition and domain registrars
│   ├── controller.ts       # Composition root that initializes the registrars and renderer events
│   ├── endpoint-registry.ts # Guarded endpoint binder and domain contract binder
│   ├── *-handlers.ts       # Per-domain endpoint registrations
│   ├── renderer-event-sender.ts # Typed event sender for main-owned windows
│   └── renderer-events.ts  # Renderer event and port listeners
└── renderer/               # Renderer process IPC client
    ├── api.ts              # Contract-keyed request client, timeout policy, and convenience port adapters
    └── renderer-events.ts  # Event subscriptions derived from EventApi
```

Module services cross these boundaries intentionally: main owns persisted trust and derives the
service snapshot from trusted roots and bundled manifests before restored windows can request a
service. The renderer applies the complete board snapshot through `BoardRegistry` and sends the
disabled-bundled-board setting input to main. Main owns the `utilityProcess` lifecycle and ordinary request path, and the static
asset host is the utility-process entry that imports the board-relative ESM module. The optional
renderer lease is a separate channel for high-volume provider traffic, not a requirement of every
service.

## When to Create New Folders

| Scenario | Location |
|----------|----------|
| New editor type | `/editors/[name]/` |
| New Object Model interface | `/api/[name].ts` + `/api/types/[name].d.ts` |
| New composed API (multiple files) | `/api/[name]/` subfolder |
| New internal service | `/api/internal/` |
| New reusable UIKit primitive | `/uikit/<ComponentName>/` |
| New persephone-coupled component | `/components/<existing-keep-folder>/` (`icons/`, `page-manager/`, `file-search/`, `file-list/`, `file-grid/`, `tree-provider/`, `git-tree/`) |
| New utility | `/core/utils/` |
| New scripting facade | `/scripting/api-wrapper/[Name]Facade.ts` |

## Import Conventions

```typescript
// Direct imports preferred — avoid barrel imports that cause circular deps
import { pages } from "../../api/pages";
import { app } from "../../api/app";

// Specific component imports — UIKit primitives
import { Button } from "../../uikit/Button/Button";

// Type-only imports for code splitting (erased at compile time)
import type { BrowserEditor } from "../../editors/browser/BrowserEditor";

// Dynamic imports for editors (preserves code splitting)
const { ArchiveEditorView } = await import("../editors/archive/ArchiveEditorView");
```
