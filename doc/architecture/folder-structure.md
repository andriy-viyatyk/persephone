# Folder Structure

Detailed organization of the codebase. Verified against actual source files.

## Root Structure

```
persephone/
├── src/                    # Source code
│   ├── main/               # Electron main process
│   ├── renderer/           # React frontend (see below)
│   ├── ipc/                # IPC communication layer
│   ├── shared/             # Shared types and constants
│   ├── renderer.tsx        # Bootstrap entry point
│   └── preload.ts          # Preload script
├── launcher/               # Rust launcher (Named Pipe client)
│   ├── src/main.rs
│   ├── build.rs
│   └── Cargo.toml
├── scripts/                # Build scripts
│   ├── build-prod.mjs      # Vite production build (main, preload, renderer)
│   └── vmp-sign.mjs        # electron-builder afterPack hook for Widevine VMP signing
├── assets/                 # Static assets
│   ├── editor-types/       # Auto-copied .d.ts files for Monaco IntelliSense
│   ├── icons/              # App icons
│   ├── pdfjs/              # PDF.js library
│   ├── excalidraw/fonts/   # Self-hosted Excalidraw fonts (woff2, OFL-1.1 licensed)
│   ├── script-library/     # Bundled example scripts (copied to user library on setup)
│   ├── mcp-res-ui-push.md  # MCP resource: ui_push tool guide
│   ├── mcp-res-pages.md    # MCP resource: pages & windows guide
│   ├── mcp-res-scripting.md # MCP resource: scripting API reference
│   ├── mcp-res-graph.md    # MCP resource: force-graph data format & page.asGraph() API
│   ├── mcp-res-notebook.md # MCP resource: notebook editor JSON format
│   ├── mcp-res-todo.md     # MCP resource: todo editor JSON format
│   └── mcp-res-links.md    # MCP resource: links editor JSON format
├── snip-tool/              # Rust native screen snip tool (persephone-snip.exe)
│   ├── src/main.rs         # Entry point, PNG encoding, stdout output
│   ├── src/capture.rs      # Monitor enumeration + GDI screen capture
│   ├── src/overlay.rs      # Fullscreen overlay windows, selection UI
│   ├── build.rs
│   └── Cargo.toml
├── patches/                # Dependency patches (patch-package)
├── .mcp.json               # MCP server config for Claude Code (points to MCP HTTP server)
├── doc/                    # Developer documentation
│   ├── architecture/       # Architecture docs (this folder)
│   ├── standards/          # Coding standards and guides
│   ├── tasks/              # Task tracking
│   └── future-architecture/ # Migration design docs (historical)
└── docs/                   # User documentation (published)
```

## Renderer Structure

```
/src/renderer/
│
├── api/                    # Object Model — application interfaces
│   ├── app.ts              # Root App class (bootstrap orchestrator)
│   ├── settings.ts         # ISettings implementation
│   ├── editors.ts          # IEditorRegistry implementation
│   ├── recent.ts           # IRecentFiles implementation
│   ├── fs.ts               # IFileSystem implementation
│   ├── archive-service.ts  # ArchiveService — archive I/O (libarchive-wasm for reads, jszip for writes), used by fs.ts for archive paths
│   ├── window.ts           # IWindow implementation
│   ├── ui.ts               # IUserInterface implementation
│   ├── downloads.ts        # IDownloads implementation
│   ├── menu-folders.ts     # IMenuFolders implementation
│   ├── library-service.ts  # LibraryService — script library scanning, caching, file watching
│   ├── autoload-service.ts # Thin wrapper exposing AutoloadRunner to app lifecycle
│   ├── pages.ts            # PagesModel singleton export
│   ├── mcp-handler.ts      # MCP command handler (receives IPC from main, dispatches commands)
│   ├── internal.ts         # Disposable utilities (wrapSubscription, etc.)
│   │
│   ├── pages/              # Page collection — composed submodels
│   │   ├── PagesModel.ts           # Base: state, subscriptions, composes submodels
│   │   ├── PagesQueryModel.ts      # Queries: getAll, byId, byType, activePage
│   │   ├── PagesNavigationModel.ts # Navigation: show, focus, next/prev
│   │   ├── PagesLifecycleModel.ts  # Lifecycle: create, close, empty page
│   │   ├── PagesLayoutModel.ts     # Layout: grouping (side-by-side)
│   │   ├── PagesPersistenceModel.ts # Persistence: save/restore, debounced
│   │   └── well-known-pages.ts     # Singleton page definitions (MCP Log, etc.)
│   │
│   ├── internal/           # Event services (init-only, not public API)
│   │   ├── GlobalEventService.ts    # contextmenu, dragover, drop, unhandled rejections
│   │   ├── KeyboardService.ts       # Global keyboard shortcuts
│   │   ├── WindowStateService.ts    # Window maximize/zoom state tracking
│   │   └── RendererEventsService.ts # IPC event subscriptions (open file, quit, etc.)
│   │
│   ├── events/             # Event channel system (scriptable events)
│   │   ├── AppEvents.ts             # app.events namespace (linkContextMenu, fileExplorer, etc.)
│   │   ├── BaseEvent.ts             # Base event class with `handled` flag
│   │   ├── EventChannel.ts          # EventChannel<T> — subscribe, send, sendAsync
│   │   ├── events.ts                # Event subclasses (ContextMenuEvent<T>, etc.)
│   │   └── index.ts
│   │
│   ├── shell/              # Shell service — OS integration
│   │   ├── index.ts                 # IShell facade (composes sub-services)
│   │   ├── shell-calls.ts           # IPC calls to main process
│   │   ├── encryption.ts            # AES-GCM encryption
│   │   └── version.ts              # Version info, update checking
│   │
│   ├── setup/              # Monaco editor configuration
│   │   ├── configure-monaco.ts      # Themes, keybindings, type definitions
│   │   ├── library-intellisense.ts  # Library module IntelliSense (addExtraLib + path completion)
│   │   └── monaco-languages/        # Custom language definitions
│   │       ├── csv.ts               # CSV rainbow coloring
│   │       ├── jsonl.ts            # JSONL (JSON Lines) syntax highlighting
│   │       ├── log.ts              # Log file syntax highlighting
│   │       ├── mermaid.ts           # Mermaid syntax highlighting
│   │       └── reg.ts              # Windows Registry file syntax
│   │
│   └── types/              # TypeScript interfaces (.d.ts)
│       ├── index.d.ts      # Global `app` and `page` declarations
│       ├── app.d.ts        # IApp interface
│       ├── common.d.ts     # IDisposable, IEvent, EditorView enum
│       ├── pages.d.ts      # IPageCollection interface
│       ├── page.d.ts       # IPage interface (with asX() methods)
│       ├── settings.d.ts   # ISettings
│       ├── editors.d.ts    # IEditorRegistry
│       ├── recent.d.ts     # IRecentFiles
│       ├── fs.d.ts         # IFileSystem
│       ├── window.d.ts     # IWindow
│       ├── shell.d.ts      # IShell + sub-services
│       ├── ui.d.ts         # IUserInterface
│       ├── downloads.d.ts  # IDownloads
│       ├── menu-folders.d.ts # IMenuFolders
│       ├── text-editor.d.ts    # ITextEditor
│       ├── grid-editor.d.ts    # IGridEditor
│       ├── notebook-editor.d.ts # INotebookEditor
│       ├── todo-editor.d.ts    # ITodoEditor
│       ├── link-editor.d.ts    # ILinkEditor
│       ├── browser-editor.d.ts # IBrowserEditor
│       ├── markdown-editor.d.ts # IMarkdownEditor
│       ├── svg-editor.d.ts     # ISvgEditor
│       ├── html-editor.d.ts    # IHtmlEditor
│       ├── mermaid-editor.d.ts # IMermaidEditor
│       ├── graph-editor.d.ts  # IGraphEditor, IGraphNode, IGraphComponent, IGraphSearchResult
│       ├── events.d.ts       # IEventChannel, IBaseEvent, IContextMenuEvent, MenuItem, IFileTarget
│       ├── io.d.ts            # IIoNamespace — script `io` global (providers, transformers, tree providers, createPipe)
│       ├── io.provider.d.ts  # IProvider, IProviderStat, IProviderDescriptor
│       ├── io.transformer.d.ts # ITransformer, ITransformerDescriptor
│       ├── io.pipe.d.ts      # IContentPipe, IPipeDescriptor
│       ├── io.link-data.d.ts # ILinkData — unified link descriptor for the pipeline (EPIC-023)
│       └── io.tree.d.ts     # ITreeProvider, ILink (was ITreeProviderItem), ITreeStat, ITreeSearch*
│
├── content/                # Content delivery layer — providers, transformers, pipes (EPIC-012)
│   ├── ContentPipe.ts      # IContentPipe implementation, createPipe() factory
│   ├── registry.ts         # Provider/transformer registries, createPipeFromDescriptor()
│   ├── encoding.ts         # Text encoding detection (BOM, jschardet) and conversion (iconv-lite)
│   ├── parsers.ts          # Layer 1: raw link parsers (file, HTTP/cURL, archive, data:) on openRawLink
│   ├── resolvers.ts        # Layer 2: pipe resolvers (file, HTTP, archive) on openLink
│   ├── link-utils.ts       # URL → pipe descriptor resolution (used by resolvers + tree providers)
│   ├── open-handler.ts     # Layer 3: open handler on openContent — creates/navigates pages
│   ├── providers/
│   │   ├── FileProvider.ts      # IProvider for local binary files (read/write/watch/stat)
│   │   ├── CacheFileProvider.ts # IProvider for cache files by page ID (auto-save)
│   │   ├── HttpProvider.ts      # IProvider for HTTP/HTTPS URLs (read-only)
│   │   └── DataUrlProvider.ts  # IProvider for data: URLs (inline content, read-only)
│   ├── transformers/
│   │   ├── ArchiveTransformer.ts # ITransformer for archive entry extraction/replacement
│   │   └── DecryptTransformer.ts # ITransformer for AES-GCM decrypt/encrypt (non-persistent)
│   ├── tree-providers/           # ITreeProvider implementations (EPIC-015)
│   │   ├── FileTreeProvider.ts  # Local filesystem directories
│   │   ├── ArchiveTreeProvider.ts # Archives (ZIP, RAR, 7z, TAR, cab, ISO — read-only)
│   │   └── tree-provider-link.ts # tree-category:// link format (encode/decode)
│   └── tree-context-menus.tsx   # Default context menu handlers for tree provider items (EPIC-015)
│
├── ui/                     # Application Shell
│   ├── app/                # Root layout
│   │   ├── MainPage.tsx            # Root component (header, tabs, editors, sidebar)
│   │   ├── Pages.tsx               # Page container/router
│   │   ├── RenderEditor.tsx        # Editor dispatcher
│   │   ├── AsyncEditor.tsx         # Async editor loader
│   │   └── index.ts
│   ├── tabs/               # Tab bar
│   │   ├── PageTabs.tsx            # Tab bar component
│   │   ├── PageTab.tsx             # Individual tab
│   │   └── index.ts
│   ├── sidebar/            # Sidebar/menu panel
│   │   ├── MenuBar.tsx             # Top menu bar
│   │   ├── OpenTabsList.tsx         # Open tabs list
│   │   ├── RecentFileList.tsx       # Recent files panel
│   │   ├── ToolsEditorsPanel.tsx    # Tools & Editors panel (pin/unpin, drag reorder)
│   │   ├── tools-editors-registry.ts # Creatable items registry (editors + tools)
│   │   ├── ScriptLibraryPanel.tsx   # Script library folder panel
│   │   ├── FileList.tsx            # File browser list
│   │   ├── FolderItem.tsx          # Folder tree item
│   │   └── index.ts
│   ├── dialogs/            # Application dialogs
│   │   ├── Dialogs.tsx             # Dialog manager/renderer
│   │   ├── Dialog.tsx              # Base dialog component
│   │   ├── ConfirmationDialog.tsx
│   │   ├── InputDialog.tsx
│   │   ├── PasswordDialog.tsx
│   │   ├── TextDialog.tsx            # Multi-purpose text dialog (Monaco editor)
│   │   ├── alerts/                 # Notification bar
│   │   │   ├── AlertsBar.tsx
│   │   │   └── AlertItem.tsx
│   │   ├── progress/               # Progress overlay, notifications, screen lock
│   │   │   ├── ProgressModel.ts    # State + API (showProgress, createProgress, notifyProgress, addScreenLock)
│   │   │   └── Progress.tsx        # React component (two-zone overlay)
│   │   ├── poppers/                # Floating menus
│   │   │   ├── Poppers.tsx
│   │   │   ├── showPopupMenu.tsx
│   │   │   └── types.ts
│   │   └── index.ts
│   └── navigation/         # Navigation panel (in-editor)
│       ├── PageNavigator.tsx       # PageNavigator — TreeProviderView + FileTreeProvider + FileSearch
│       └── PageNavigatorModel.ts   # Reactive state for PageNavigator (open, width)
│
├── editors/                # Editor Implementations
│   ├── base/               # Shared editor infrastructure
│   │   ├── EditorModel.ts            # Base editor model (state, icon, nav panel, script data)
│   │   ├── ContentViewModel.ts     # Base class for content-view models
│   │   ├── ContentViewModelHost.ts # Ref-counting host for ViewModels
│   │   ├── useContentViewModel.ts  # React hook for ViewModel lifecycle
│   │   ├── IContentHost.ts         # Interface for content-view hosting
│   │   ├── EditorToolbar.tsx       # Base toolbar component
│   │   ├── EditorConfigContext.tsx  # Editor configuration provider
│   │   ├── EditorStateStorageContext.tsx # Persistent editor state
│   │   ├── EditorError.tsx         # Error boundary
│   │   └── index.ts
│   │
│   ├── text/               # Monaco text editor (content-view host)
│   │   ├── TextEditorModel.ts        # TextFileModel — hosts content-views
│   │   ├── TextEditorView.tsx        # Main view (toolbar + active editor)
│   │   ├── TextEditor.tsx          # Monaco editor component + TextViewModel
│   │   ├── ActiveEditor.tsx        # Content-view switcher
│   │   ├── TextToolbar.tsx         # Text-specific toolbar
│   │   ├── TextFooter.tsx          # Status bar
│   │   ├── ScriptPanel.tsx         # Inline script runner
│   │   ├── EncryptionPanel.tsx     # Encryption UI
│   │   ├── TextFileIOModel.ts      # File I/O via content pipes (read/write/watch/cache)
│   │   ├── TextFileActionsModel.ts # Text actions (duplicate, transform)
│   │   ├── TextFileEncryptionModel.ts # Encryption state
│   │   └── index.ts
│   ├── grid/               # JSON/CSV grid editor (content-view)
│   │   ├── GridEditor.tsx          # Grid component
│   │   ├── GridViewModel.ts        # Grid view state
│   │   ├── components/             # Grid-specific components
│   │   ├── utils/                  # Grid utilities
│   │   └── index.ts
│   ├── markdown/           # Markdown preview (content-view)
│   │   ├── MarkdownBlock.tsx       # Reusable markdown rendering (CSS, ReactMarkdown, search handle)
│   │   ├── MarkdownView.tsx        # Page shell (scroll, minimap, toolbar, search bar)
│   │   ├── MarkdownViewModel.ts    # View state (search, compact, scroll)
│   │   ├── MarkdownSearchBar.tsx   # Search within preview
│   │   ├── CodeBlock.tsx           # Code block + inline Mermaid
│   │   ├── rehypeHighlight.ts      # Search text highlighting
│   │   └── index.ts
│   │
│   ├── browser/            # Built-in browser (standalone)
│   │   ├── BrowserEditorModel.ts     # Multi-tab browser state
│   │   ├── BrowserEditorView.tsx     # Browser UI
│   │   ├── BrowserWebviewModel.ts  # Webview management
│   │   ├── BrowserUrlBarModel.ts   # URL bar state
│   │   ├── BrowserTargetModel.ts   # Automation adapter (implements IBrowserTarget)
│   │   ├── BrowserTabsPanel.tsx    # Browser tab bar
│   │   ├── BrowserFindBar.tsx      # Find in page
│   │   ├── BookmarksDrawer.tsx     # Bookmarks panel
│   │   ├── DownloadButton.tsx      # Download indicator
│   │   ├── BrowserDownloadsPopup.tsx # Download list popup
│   │   ├── UrlSuggestionsDropdown.tsx # URL autocomplete
│   │   ├── TorStatusOverlay.tsx    # Tor connection status
│   │   ├── BrowserBookmarks.ts     # Bookmarks data management
│   │   ├── BrowserBookmarksUIModel.ts # Bookmarks UI state
│   │   ├── browser-search-history.ts  # Search history
│   │   ├── network-log-links.ts    # Network log → ILink[] conversion
│   │   └── index.ts
│   ├── notebook/           # Notebook editor (standalone)
│   │   ├── NotebookEditor.tsx
│   │   ├── NotebookEditorModel.ts  # Page model
│   │   ├── NotebookViewModel.ts    # View model
│   │   ├── NoteItemView.tsx
│   │   ├── NoteItemViewModel.ts
│   │   ├── ExpandedNoteView.tsx
│   │   ├── notebookTypes.ts
│   │   ├── note-editor/            # Note item sub-editor
│   │   └── index.ts
│   ├── todo/               # Todo editor (standalone)
│   │   ├── TodoEditor.tsx
│   │   ├── TodoViewModel.ts
│   │   ├── todoTypes.ts
│   │   ├── todoColors.ts
│   │   ├── components/
│   │   └── index.ts
│   ├── link-editor/        # Link collection editor (standalone)
│   │   ├── LinkEditor.tsx
│   │   ├── LinkViewModel.ts
│   │   ├── LinkTreeProvider.ts  # ITreeProvider adapter over LinkViewModel
│   │   ├── linkTypes.ts
│   │   ├── panels/             # Shared panel components (inline + secondary editor)
│   │   │   ├── LinkCategoryPanel.tsx       # Categories tree panel
│   │   │   ├── LinkTagsPanel.tsx           # Tags list panel
│   │   │   ├── LinkHostnamesPanel.tsx      # Hostnames list panel
│   │   │   ├── LinkCategorySecondaryEditor.tsx  # Secondary editor wrapper
│   │   │   ├── LinkTagsSecondaryEditor.tsx      # Secondary editor wrapper
│   │   │   └── LinkHostnamesSecondaryEditor.tsx # Secondary editor wrapper
│   │   ├── linkTraits.ts        # ILink trait definition + registration (TraitTypeId.ILink)
│   │   ├── LinksList.tsx        # View-only list rendering (no ViewModel deps)
│   │   ├── LinksTiles.tsx       # View-only tiles rendering (no ViewModel deps)
│   │   ├── LinkItemList.tsx     # Wrapper: wires LinksList to LinkViewModel
│   │   ├── LinkItemTiles.tsx    # Wrapper: wires LinksTiles to LinkViewModel
│   │   ├── PinnedLinksPanel.tsx
│   │   ├── EditLinkDialog.tsx
│   │   └── index.ts
│   ├── svg/                # SVG preview (content-view)
│   │   ├── SvgView.tsx
│   │   ├── SvgViewModel.ts
│   │   └── index.ts
│   ├── html/               # HTML preview (content-view)
│   │   ├── HtmlView.tsx
│   │   ├── HtmlViewModel.ts
│   │   └── index.ts
│   ├── mermaid/            # Mermaid diagram preview (content-view)
│   │   ├── MermaidView.tsx
│   │   ├── MermaidViewModel.ts
│   │   ├── render-mermaid.ts       # Rendering utilities (shared with Markdown)
│   │   └── index.ts
│   ├── graph/              # Force graph viewer (content-view)
│   │   ├── GraphView.tsx           # Canvas-based graph component (toolbar with search/selection/physics/expansion tabs, tooltip, detail panel)
│   │   ├── GraphViewModel.ts       # ContentViewModel — JSON parsing, orchestration, delegates to sub-models
│   │   ├── GraphDataModel.ts      # Source data ownership + node/link CRUD + legend data
│   │   ├── GraphSearchModel.ts    # Search query matching + result computation
│   │   ├── GraphGroupModel.ts    # Group membership analysis + link pre-processing (hide membership, split cross-group, dedup)
│   │   ├── GraphConnectivityModel.ts # Read-only query layer bridging original/preprocessed graphs (real neighbors, visual paths, group analysis)
│   │   ├── GraphHighlightModel.ts # Highlight layers (search, legend, links tab) + selection/hover state + color helpers
│   │   ├── GraphContextMenu.ts    # Context menu item builders (node menu with link opening, group node menu, empty area menu, selection menu)
│   │   ├── ForceGraphRenderer.ts   # D3 force simulation + canvas rendering
│   │   ├── GraphVisibilityModel.ts # BFS-based visibility filtering for large graphs
│   │   ├── GraphDetailPanel.tsx    # Collapsible detail panel overlay (Info tab, Links tab, Properties tab — AVGrid batch editing)
│   │   ├── GraphTuningSliders.tsx  # Force tuning sliders (charge, distance, collide) — expandable from toolbar
│   │   ├── GraphExpansionSettings.tsx # Expansion settings panel (root node, expand depth, max visible)
│   │   ├── GraphLegendPanel.tsx    # Collapsible legend panel (bottom-left, Selection/Level/Shape tabs, checkbox highlighting, description persistence)
│   │   ├── GraphIcons.tsx         # Shared SVG icon components (ShapeIcon, LevelIcon)
│   │   ├── GraphTooltip.tsx        # Node tooltip (fixed-position portal, custom properties, markdown link rendering, copy as markdown, open in page)
│   │   ├── shapeGeometry.ts       # Pure shape point generation (shared between canvas + SVG icons)
│   │   ├── types.ts                # GraphNode, GraphLink, GraphLegend, GraphData, GraphOptions, NodeShape, nodeLabel(), nodeRadius(), effectiveNodeRadius(), getCustomProperties(), isReservedPropertyKey(), NodePropertyLink, getNodeLinks(), toNavigableHref(), openNodeLink()
│   │   ├── constants.ts            # Force simulation parameters
│   │   └── index.ts
│   ├── draw/               # Excalidraw drawing editor (content-view)
│   │   ├── DrawView.tsx           # Wraps <Excalidraw> component (debounced onChange, asset path setup, export toolbar)
│   │   ├── DrawViewModel.ts       # ContentViewModel — JSON parsing, fingerprint-based change detection, dark mode state
│   │   ├── drawExport.ts         # Export helpers — exportAsSvgText(), exportAsPngBlob(), buildExcalidrawJsonWithImage() (embed image as Excalidraw element)
│   │   ├── drawLibrary.ts        # Library persistence — LibraryPersistenceAdapter for useHandleLibrary, default path init
│   │   └── index.ts
│   ├── log-view/           # Log viewer (content-view)
│   │   ├── LogViewEditor.tsx       # Log viewer component (RenderFlexGrid + auto-scroll)
│   │   ├── LogViewModel.ts         # ContentViewModel — JSONL parsing, entry management
│   │   ├── LogViewContext.ts       # React Context providing LogViewModel to dialog views
│   │   ├── LogEntryWrapper.tsx     # Cell root — subscribes to entries[index] via selector
│   │   ├── LogEntryContent.tsx     # Type router — dispatches to entry renderers (with EntryErrorBoundary)
│   │   ├── LogMessageView.tsx      # Log message renderer (text/info/warn/error/success)
│   │   ├── StyledTextView.tsx      # StyledText renderer (plain string or styled segments)
│   │   ├── logTypes.ts             # LogEntry, StyledText, dialog/output types
│   │   ├── logConstants.ts         # Shared constants (DIALOG_CONTENT_MAX_HEIGHT)
│   │   └── items/                  # Dialog and output entry renderers
│   │       ├── DialogContainer.tsx     # Shared styled wrapper (active/resolved border)
│   │       ├── DialogHeader.tsx        # Optional title bar
│   │       ├── ButtonsPanel.tsx        # Reusable button row with ! prefix + check icon
│   │       ├── ConfirmDialogView.tsx   # input.confirm renderer
│   │       ├── TextInputDialogView.tsx # input.text renderer
│   │       ├── ButtonsDialogView.tsx   # input.buttons renderer
│   │       ├── CheckboxesDialogView.tsx # input.checkboxes renderer
│   │       ├── RadioboxesDialogView.tsx # input.radioboxes renderer
│   │       ├── SelectDialogView.tsx     # input.select renderer
│   │       ├── ProgressOutputView.tsx   # output.progress renderer
│   │       ├── GridOutputView.tsx       # output.grid renderer (inline AVGrid)
│   │       ├── TextOutputView.tsx       # output.text renderer (inline Monaco editor)
│   │       ├── MarkdownOutputView.tsx  # output.markdown renderer (inline MarkdownBlock)
│   │       ├── MermaidOutputView.tsx  # output.mermaid renderer (inline mermaid diagram)
│   │       └── McpRequestView.tsx   # output.mcp-request renderer (direction, method, collapsible JSON)
│   ├── pdf/                # PDF viewer (standalone)
│   │   ├── PdfViewer.tsx
│   │   └── index.ts
│   ├── image/              # Image viewer (standalone)
│   │   ├── ImageViewer.tsx
│   │   ├── BaseImageView.tsx
│   │   └── index.ts
│   ├── mcp-inspector/      # MCP Inspector (standalone)
│   │   ├── McpInspectorEditorModel.ts      # EditorModel — connection, tools, resources (+ templates), prompts state
│   │   ├── McpInspectorView.tsx      # Main view — connection bar, panel routing
│   │   ├── McpConnectionManager.ts   # MCP SDK Client wrapper (connect/disconnect)
│   │   ├── ToolsPanel.tsx            # Tools panel — sidebar list, detail, arg form, result
│   │   ├── ToolArgForm.tsx           # JSON Schema → argument form generator
│   │   ├── ToolResultView.tsx        # Tool call result renderer (text/image/resource)
│   │   ├── ResourcesPanel.tsx        # Resources panel — sidebar, static resources + interactive templates, content display
│   │   ├── ResourceContentView.tsx   # Adaptive content renderer (markdown/monaco/image)
│   │   ├── PromptsPanel.tsx          # Prompts panel — sidebar, arg form, messages display
│   │   ├── McpConnectionStore.ts    # Saved connections store (mcp-connections.json persistence)
│   │   └── index.ts
│   ├── compare/            # Diff editor (standalone)
│   │   ├── CompareEditor.tsx
│   │   └── index.ts
│   ├── about/              # About page (standalone)
│   │   ├── AboutPage.tsx
│   │   └── index.ts
│   ├── settings/           # Settings page (standalone)
│   │   └── SettingsPage.tsx
│   ├── video/              # Audio/Video player (standalone)
│   │   ├── VideoPlayerEditor.tsx  # EditorModel + EditorModule (state, model, component)
│   │   ├── VPlayer.tsx            # Video playback component (video.js + hls.js)
│   │   ├── AudioPlayer.tsx        # Audio file playback with visualizer
│   │   ├── AudioVisualizer.tsx    # Audio frequency visualization with switchable effects
│   │   ├── effects/               # Audio visualizer effect implementations
│   │   │   ├── types.ts           # IVisualizerEffect interface, EffectType
│   │   │   ├── BarsEffect.ts      # Frequency bars visualizer
│   │   │   └── CircularEffect.ts  # Circular rings visualizer with cross-band modulation
│   │   ├── NodeFetchHlsLoader.ts  # Custom hls.js loader via nodeFetch (bypass forbidden headers)
│   │   └── video-types.ts         # VideoFormat, PlayerState, detectVideoFormat()
│   ├── category/           # Category/folder view (standalone, provider-agnostic)
│   │   ├── CategoryEditor.tsx             # Wraps CategoryView, resolves provider from secondary editors
│   │   ├── CategoryEditorModel.ts         # Page model — decodes tree-category:// link
│   │   └── FolderViewModeService.ts       # Per-folder view mode persistence with hierarchical inheritance
│   ├── archive/            # Archive editor (secondary — sidebar panel)
│   │   ├── ArchiveEditorModel.ts      # EditorModel — archive state, tree provider, navigation survival
│   │   ├── ArchiveEditorView.tsx      # Main content view (archive-view)
│   │   ├── ArchiveSecondaryEditor.tsx # Secondary panel — tree view with portaled header
│   │   └── index.ts
│   ├── explorer/            # File explorer (secondary — sidebar panels)
│   │   ├── ExplorerEditorModel.ts     # EditorModel — tree provider, selection, search, root navigation
│   │   ├── ExplorerSecondaryEditor.tsx # "explorer" panel — tree view with portaled header
│   │   ├── SearchSecondaryEditor.tsx  # "search" panel — file search with portaled header
│   │   └── index.ts
│   ├── shared/             # Shared editor utilities
│   │   ├── link-open-menu.tsx
│   │   └── ColorizedCode.tsx   # Syntax-highlighted code via Monaco colorize()
│   │
│   ├── registry.ts         # EditorRegistry — resolution, validation
│   ├── register-editors.ts # Editor registration (all editors)
│   ├── types.ts            # EditorDefinition, EditorCategory
│   └── index.ts
│
├── scripting/              # Script Execution
│   ├── ScriptRunnerBase.ts # Core execution engine (transpile, execute, library)
│   ├── ScriptRunner.ts     # Orchestrator (context lifecycle, result handling)
│   ├── ScriptContext.ts    # Execution scope class (context proxy, cleanup)
│   ├── AutoloadRunner.ts   # Autoload registration scripts from library/autoload/
│   ├── script-utils.ts     # Utilities (convertToText)
│   ├── transpile.ts        # TypeScript transpilation via sucrase (lazy-loaded)
│   ├── library-require.ts  # Library require() resolution + .ts extension handler
│   ├── worker/             # Background worker execution (app.runAsync)
│   │   └── WorkerRunner.ts # Renderer-side: IPC to main, proxy dispatch
│   └── api-wrapper/        # Safe wrappers for script access
│       ├── AppWrapper.ts           # Wraps app → IApp (events proxy for auto-cleanup)
│       ├── PageCollectionWrapper.ts # Wraps pages → IPageCollection
│       ├── PageWrapper.ts          # Wraps page → IPage (with asX() + auto-release)
│       ├── TextEditorFacade.ts     # ITextEditor facade
│       ├── GridEditorFacade.ts     # IGridEditor facade
│       ├── NotebookEditorFacade.ts # INotebookEditor facade
│       ├── TodoEditorFacade.ts     # ITodoEditor facade
│       ├── LinkEditorFacade.ts     # ILinkEditor facade
│       ├── BrowserEditorFacade.ts  # IBrowserEditor facade
│       ├── MarkdownEditorFacade.ts # IMarkdownEditor facade
│       ├── SvgEditorFacade.ts      # ISvgEditor facade
│       ├── HtmlEditorFacade.ts     # IHtmlEditor facade
│       ├── MermaidEditorFacade.ts  # IMermaidEditor facade
│       ├── GraphEditorFacade.ts   # IGraphEditor facade (graph query/analysis, designed for MCP)
│       ├── UiFacade.ts             # Log View UI (logging + dialogs + output)
│       ├── Progress.ts            # Progress helper class (returned by ui.show.progress)
│       ├── Grid.ts                # Grid helper class (returned by ui.show.grid)
│       ├── Text.ts                # Text helper class (returned by ui.show.text)
│       ├── Markdown.ts            # Markdown helper class (returned by ui.show.markdown)
│       ├── Mermaid.ts             # Mermaid helper class (returned by ui.show.mermaid)
│       └── StyledTextBuilder.ts    # Fluent styled text builder + styledText() factory
│
├── automation/             # Browser Automation (Playwright-compatible MCP tools)
│   ├── types.ts            # IBrowserTarget interface
│   ├── CdpSession.ts       # CDP session wrapper (IPC to main process debugger)
│   ├── snapshot.ts         # Accessibility snapshot (main frame + iframes, overlay detection)
│   ├── input.ts            # Keyboard/text input (typeText, pressKey, fill strategies)
│   ├── ref.ts              # Ref resolution (parseRef, resolveRef, callOnRef)
│   └── commands.ts         # browser_* MCP command handlers
│
├── components/             # Reusable UI Components
│   ├── basic/              # Atomic: Button, Input, TextField, Chip, Tooltip, etc.
│   ├── form/               # Form controls: ComboSelect, SwitchButtons, ListMultiselect
│   ├── layout/             # Layout: Splitter, CollapsiblePanelStack, Minimap
│   ├── overlay/            # Floating UI: Popper, PopupMenu, WithPopupMenu
│   ├── TreeView/           # Virtualized tree component
│   ├── data-grid/          # Advanced data grid (AVGrid)
│   ├── virtualization/     # Base virtualization (RenderGrid)
│   ├── tree-provider/      # TreeProviderView — generic tree viewer for any ITreeProvider (EPIC-015)
│   │   ├── favicon-cache.ts # Favicon download/cache for HTTP links (shared by link-editor, browser, tree icons)
│   ├── file-search/        # FileSearch — standalone file content search with virtualized results (EPIC-015)
│   ├── icons/              # FileIcon, LanguageIcon
│   └── page-manager/       # Portal-based page/tab host (prevents iframe/webview reload on reorder)
│
├── core/                   # Core Infrastructure
│   ├── state/              # State management primitives
│   │   ├── state.ts        # TOneState, TComponentState, TGlobalState
│   │   ├── model.ts        # TModel, TDialogModel, TComponentModel
│   │   ├── events.ts       # Subscription event system
│   │   ├── view.tsx        # View registry (dialogs/poppers)
│   │   └── index.ts
│   ├── traits/             # Trait system — drag-and-drop type negotiation (EPIC-026)
│   │   ├── traits.ts       # TraitKey<T>, TraitSet, Traited<V>, traited(), isTraited()
│   │   ├── TraitRegistry.ts # TraitRegistry singleton + TraitTypeId enum
│   │   ├── dnd.ts          # setTraitDragData, getTraitDragData, hasTraitDragData, resolveTraits
│   │   └── index.ts        # Public exports
│   ├── utils/              # Utility functions
│   │   ├── utils.ts        # General helpers
│   │   ├── parse-utils.ts  # JSON5, JS parsing
│   │   ├── csv-utils.ts    # CSV parsing/generation
│   │   ├── html-resources.ts  # HTML resource extraction (cheerio)
│   │   ├── file-path.ts    # Archive-aware path utility (wraps ALL path.* usage)
│   │   ├── path-utils.ts   # Markdown link resolution
│   │   ├── obj-path.ts     # Deep object access by path
│   │   ├── language-mapping.ts  # Extension → Monaco language
│   │   ├── monaco-languages.ts  # Monaco language config
│   │   ├── file-watcher.ts      # File change detection
│   │   ├── memorize.ts          # Memoization
│   │   ├── types.ts             # Type helpers
│   │   └── index.ts
│   └── index.ts
│
├── theme/                  # Styling
│   ├── color.ts            # Color tokens (CSS custom properties)
│   ├── GlobalStyles.tsx    # Global CSS reset
│   ├── icons.tsx           # SVG icon components
│   ├── language-icons.tsx  # Language-specific icons
│   ├── palette-colors.ts   # Color palette definitions
│   └── themes/             # Theme definitions (9 themes)
│
├── types/                  # Global Type Declarations
│   ├── window.d.ts         # Window interface extension
│   └── events.d.ts         # MouseEvent extension
│
└── index.tsx               # React root component (AppContent)
```

## Main Process Structure

```
/src/main/
├── main-setup.ts           # Application setup and window creation
├── open-window.ts          # Window creation logic
├── open-windows.ts         # Multi-window management and broadcasting
├── window-states.ts        # Window state persistence
├── pipe-server.ts          # Named Pipe server (launcher integration)
├── mcp-http-server.ts      # MCP Streamable HTTP server (MCP SDK, AI agent integration)
├── browser-service.ts      # Browser page support (webview management)
├── browser-registration.ts # Default browser registration
├── tor-service.ts          # Tor process lifecycle and per-partition SOCKS5 proxy
├── download-service.ts     # Download management
├── search-service.ts       # File search service
├── worker-host.ts          # Worker thread host for app.runAsync (IPC + worker_threads)
├── snip-service.ts         # Screen snip (spawns persephone-snip.exe, reads PNG from stdout)
├── version-service.ts      # Version checking (runs in main, not renderer)
├── video-stream-server.ts  # Local HTTP streaming server (range requests, faststart MP4 relocation, session management)
├── vlc-launcher.ts         # VLC process launcher (spawn + auto-detect VLC path)
├── tray-setup.ts           # System tray
├── drag-model.ts           # Tab drag between windows
├── e-store.ts              # Electron store wrapper
├── fileIconCache.ts        # File icon caching
├── constants.ts            # Main process constants
└── utils.ts                # Main process utilities
```

## IPC Layer

```
/src/ipc/
├── api-types.ts            # IPC channel definitions
├── api-param-types.ts      # IPC parameter types
├── browser-ipc.ts          # Browser-specific IPC channels
├── tor-ipc.ts              # Tor service IPC channels (start, stop, log)
├── search-ipc.ts           # Search IPC channels
├── worker-channels.ts      # Worker thread IPC channels (app.runAsync)
├── popup-rate-limiter.ts   # Global popup/tab rate limiter (app-wide singleton)
├── main/                   # Main process handlers
│   ├── controller.ts       # IPC handler registration
│   ├── dialog-handlers.ts  # File dialog handlers
│   ├── renderer-events.ts  # Events sent TO renderer
│   └── window-handlers.ts  # Window management handlers
└── renderer/               # Renderer process API
    ├── api.ts              # IPC API (typed method calls)
    └── renderer-events.ts  # Events received FROM main
```

## When to Create New Folders

| Scenario | Location |
|----------|----------|
| New editor type | `/editors/[name]/` |
| New Object Model interface | `/api/[name].ts` + `/api/types/[name].d.ts` |
| New composed API (multiple files) | `/api/[name]/` subfolder |
| New internal service | `/api/internal/` |
| Reusable UI component | `/components/[category]/` |
| New utility | `/core/utils/` |
| New scripting facade | `/scripting/api-wrapper/[Name]Facade.ts` |

## Import Conventions

```typescript
// Direct imports preferred — avoid barrel imports that cause circular deps
import { pagesModel } from "../../api/pages";
import { app } from "../../api/app";

// Specific component imports
import { Button } from "../../components/basic/Button";

// Type-only imports for code splitting (erased at compile time)
import type { BrowserEditorModel } from "../../editors/browser/BrowserEditorModel";

// Dynamic imports for editors (preserves code splitting)
const { PdfViewer } = await import("../editors/pdf/PdfViewer");
```
