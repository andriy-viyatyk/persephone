# Folder Structure

Detailed organization of the codebase. Verified against actual source files.

## Root Structure

```
js-notepad/
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
├── assets/                 # Static assets
│   ├── editor-types/       # Auto-copied .d.ts files for Monaco IntelliSense
│   ├── icons/              # App icons
│   ├── pdfjs/              # PDF.js library
│   └── mcp-api-guide.md    # Condensed API guide exposed as MCP resource
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
│   ├── window.ts           # IWindow implementation
│   ├── ui.ts               # IUserInterface implementation
│   ├── downloads.ts        # IDownloads implementation
│   ├── menu-folders.ts     # IMenuFolders implementation
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
│   │   └── PagesPersistenceModel.ts # Persistence: save/restore, debounced
│   │
│   ├── internal/           # Event services (init-only, not public API)
│   │   ├── GlobalEventService.ts    # contextmenu, dragover, drop, unhandled rejections
│   │   ├── KeyboardService.ts       # Global keyboard shortcuts
│   │   ├── WindowStateService.ts    # Window maximize/zoom state tracking
│   │   └── RendererEventsService.ts # IPC event subscriptions (open file, quit, etc.)
│   │
│   ├── shell/              # Shell service — OS integration
│   │   ├── index.ts                 # IShell facade (composes sub-services)
│   │   ├── shell-calls.ts           # IPC calls to main process
│   │   ├── encryption.ts            # AES-GCM encryption
│   │   └── version.ts              # Version info, update checking
│   │
│   ├── setup/              # Monaco editor configuration
│   │   ├── configure-monaco.ts      # Themes, keybindings, type definitions
│   │   └── monaco-languages/        # Custom language definitions
│   │       ├── csv.ts               # CSV rainbow coloring
│   │       ├── mermaid.ts           # Mermaid syntax highlighting
│   │       └── reg.ts              # Windows Registry file syntax
│   │
│   └── types/              # TypeScript interfaces (.d.ts)
│       ├── index.d.ts      # Global `app` and `page` declarations
│       ├── app.d.ts        # IApp interface
│       ├── common.d.ts     # IDisposable, IEvent, PageEditor enum
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
│       └── mermaid-editor.d.ts # IMermaidEditor
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
│   │   ├── FileList.tsx            # File browser list
│   │   ├── FolderItem.tsx          # Folder tree item
│   │   └── index.ts
│   ├── dialogs/            # Application dialogs
│   │   ├── Dialogs.tsx             # Dialog manager/renderer
│   │   ├── Dialog.tsx              # Base dialog component
│   │   ├── ConfirmationDialog.tsx
│   │   ├── InputDialog.tsx
│   │   ├── PasswordDialog.tsx
│   │   ├── alerts/                 # Notification bar
│   │   │   ├── AlertsBar.tsx
│   │   │   └── AlertItem.tsx
│   │   ├── poppers/                # Floating menus
│   │   │   ├── Poppers.tsx
│   │   │   ├── showPopupMenu.tsx
│   │   │   └── types.ts
│   │   └── index.ts
│   └── navigation/         # Navigation panel (in-editor)
│       ├── NavigationPanel.tsx
│       ├── SearchResultsPanel.tsx
│       ├── NavigationSearchModel.ts
│       └── nav-panel-store.ts
│
├── editors/                # Editor Implementations
│   ├── base/               # Shared editor infrastructure
│   │   ├── PageModel.ts            # Base page model (state, icon, nav panel, script data)
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
│   │   ├── TextPageModel.ts        # TextFileModel — hosts content-views
│   │   ├── TextPageView.tsx        # Main view (toolbar + active editor)
│   │   ├── TextEditor.tsx          # Monaco editor component + TextViewModel
│   │   ├── ActiveEditor.tsx        # Content-view switcher
│   │   ├── TextToolbar.tsx         # Text-specific toolbar
│   │   ├── TextFooter.tsx          # Status bar
│   │   ├── ScriptPanel.tsx         # Inline script runner
│   │   ├── EncryptionPanel.tsx     # Encryption UI
│   │   ├── TextFileIOModel.ts      # File I/O operations
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
│   │   ├── MarkdownView.tsx        # Rendered markdown
│   │   ├── MarkdownViewModel.ts    # View state (container, search, scroll)
│   │   ├── MarkdownSearchBar.tsx   # Search within preview
│   │   ├── CodeBlock.tsx           # Code block + inline Mermaid
│   │   ├── rehypeHighlight.ts      # Search text highlighting
│   │   └── index.ts
│   │
│   ├── browser/            # Built-in browser (page-editor)
│   │   ├── BrowserPageModel.ts     # Multi-tab browser state
│   │   ├── BrowserPageView.tsx     # Browser UI
│   │   ├── BrowserWebviewModel.ts  # Webview management
│   │   ├── BrowserUrlBarModel.ts   # URL bar state
│   │   ├── BrowserTabsPanel.tsx    # Browser tab bar
│   │   ├── BrowserFindBar.tsx      # Find in page
│   │   ├── BookmarksDrawer.tsx     # Bookmarks panel
│   │   ├── DownloadButton.tsx      # Download indicator
│   │   ├── BrowserDownloadsPopup.tsx # Download list popup
│   │   ├── UrlSuggestionsDropdown.tsx # URL autocomplete
│   │   ├── BrowserBookmarks.ts     # Bookmarks data management
│   │   ├── BrowserBookmarksUIModel.ts # Bookmarks UI state
│   │   ├── browser-search-history.ts  # Search history
│   │   └── index.ts
│   ├── notebook/           # Notebook editor (page-editor)
│   │   ├── NotebookEditor.tsx
│   │   ├── NotebookEditorModel.ts  # Page model
│   │   ├── NotebookViewModel.ts    # View model
│   │   ├── NoteItemView.tsx
│   │   ├── NoteItemViewModel.ts
│   │   ├── ExpandedNoteView.tsx
│   │   ├── notebookTypes.ts
│   │   ├── note-editor/            # Note item sub-editor
│   │   └── index.ts
│   ├── todo/               # Todo editor (page-editor)
│   │   ├── TodoEditor.tsx
│   │   ├── TodoViewModel.ts
│   │   ├── todoTypes.ts
│   │   ├── todoColors.ts
│   │   ├── components/
│   │   └── index.ts
│   ├── link-editor/        # Link collection editor (page-editor)
│   │   ├── LinkEditor.tsx
│   │   ├── LinkViewModel.ts
│   │   ├── linkTypes.ts
│   │   ├── favicon-cache.ts
│   │   ├── PinnedLinksPanel.tsx
│   │   ├── LinkItemTiles.tsx
│   │   ├── LinkItemList.tsx
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
│   ├── pdf/                # PDF viewer (page-editor)
│   │   ├── PdfViewer.tsx
│   │   └── index.ts
│   ├── image/              # Image viewer (page-editor)
│   │   ├── ImageViewer.tsx
│   │   ├── BaseImageView.tsx
│   │   └── index.ts
│   ├── compare/            # Diff editor (page-editor)
│   │   ├── CompareEditor.tsx
│   │   └── index.ts
│   ├── about/              # About page (page-editor)
│   │   ├── AboutPage.tsx
│   │   └── index.ts
│   ├── settings/           # Settings page (page-editor)
│   │   └── SettingsPage.tsx
│   ├── shared/             # Shared editor utilities
│   │   └── link-open-menu.tsx
│   │
│   ├── registry.ts         # EditorRegistry — resolution, validation
│   ├── register-editors.ts # Editor registration (all editors)
│   ├── types.ts            # EditorDefinition, EditorCategory
│   └── index.ts
│
├── scripting/              # Script Execution
│   ├── ScriptRunner.ts     # Script engine (expression/statement, async, errors)
│   ├── ScriptContext.ts    # Sandbox context (globals, cleanup, read-only proxy)
│   └── api-wrapper/        # Safe wrappers for script access
│       ├── AppWrapper.ts           # Wraps app → IApp
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
│       └── MermaidEditorFacade.ts  # IMermaidEditor facade
│
├── components/             # Reusable UI Components
│   ├── basic/              # Atomic: Button, Input, TextField, Chip, Tooltip, etc.
│   ├── form/               # Form controls: ComboSelect, SwitchButtons, ListMultiselect
│   ├── layout/             # Layout: Splitter, CollapsiblePanelStack, Minimap
│   ├── overlay/            # Floating UI: Popper, PopupMenu, WithPopupMenu
│   ├── TreeView/           # Virtualized tree component
│   ├── data-grid/          # Advanced data grid (AVGrid)
│   ├── virtualization/     # Base virtualization (RenderGrid)
│   ├── file-explorer/      # File explorer component
│   └── icons/              # FileIcon, LanguageIcon
│
├── core/                   # Core Infrastructure
│   ├── state/              # State management primitives
│   │   ├── state.ts        # TOneState, TComponentState, TGlobalState
│   │   ├── model.ts        # TModel, TDialogModel, TComponentModel
│   │   ├── events.ts       # Subscription event system
│   │   ├── view.tsx        # View registry (dialogs/poppers)
│   │   └── index.ts
│   ├── utils/              # Utility functions
│   │   ├── utils.ts        # General helpers
│   │   ├── parse-utils.ts  # JSON5, JS parsing
│   │   ├── csv-utils.ts    # CSV parsing/generation
│   │   ├── path-utils.ts   # File path manipulation
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
├── download-service.ts     # Download management
├── search-service.ts       # File search service
├── version-service.ts      # Version checking (runs in main, not renderer)
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
├── search-ipc.ts           # Search IPC channels
├── popup-rate-limiter.ts   # Browser popup rate limiting
├── main/                   # Main process handlers
│   ├── controller.ts       # IPC handler registration
│   ├── dialog-handlers.ts  # File dialog handlers
│   ├── registry-handler.ts # Default app registration
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
import type { BrowserPageModel } from "../../editors/browser/BrowserPageModel";

// Dynamic imports for editors (preserves code splitting)
const { PdfViewer } = await import("../editors/pdf/PdfViewer");
```
