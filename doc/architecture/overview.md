# Architecture Overview

> Read this document before creating new modules or making architectural changes.

## Application Type

js-notepad is an **Electron desktop application** — a Windows Notepad replacement designed for developers. It combines:
- Monaco Editor (VS Code engine) for text editing
- Custom editors for specific file types (Grid, PDF, Markdown, Notebook, Todo, etc.)
- JavaScript/TypeScript execution environment for data transformation
- Built-in browser with multi-tab support

## Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├─────────────────────┬───────────────────────────────────────┤
│    Main Process     │          Renderer Process             │
│    (Node.js)        │          (Chromium + React)           │
├─────────────────────┼───────────────────────────────────────┤
│ - Window management │ - React UI                            │
│ - System tray       │ - Monaco Editor                       │
│ - File dialogs      │ - Object Model (app.*)                │
│ - Named Pipe server │ - Script execution                    │
│ - MCP HTTP server   │ - MCP command handler                 │
│ - Native menus      │ - Editor system                       │
│ - Version service   │                                       │
└─────────────────────┴───────────────────────────────────────┘
         │                           │
         └───────── IPC ─────────────┘
              (Inter-Process Communication)
```

### Key Characteristics

- **nodeIntegration: true** — Renderer has full Node.js access
- **contextIsolation: false** — Direct Node.js in renderer
- Scripts can `require()` any Node.js module or npm package
- Multi-window support — each window has its own `app` instance

## Object Model

The **Object Model** is the central architectural concept. It provides a single, typed API (`app.*`) that all consumers use — React components, user scripts, and coding agents all access the same interfaces.

```
  Consumers:   React UI  │  User Scripts  │  Coding Agents
                 │               │                │
  Access:    direct import  │  app/page globals  │  .d.ts types
                 │               │                │
  Object Model:  app.settings, app.fs, app.pages, app.window, app.ui, ...
                 │
  Implementation:  /src/renderer/api/  (one module per interface)
```

### Key interfaces

| Interface | Access | Purpose |
|-----------|--------|---------|
| `app.settings` | `ISettings` | Theme, user preferences |
| `app.editors` | `IEditorRegistry` | Available editors, resolution |
| `app.recent` | `IRecentFiles` | Recently opened files |
| `app.fs` | `IFileSystem` | File I/O, dialogs, paths |
| `app.window` | `IWindow` | Window state, zoom, multi-window |
| `app.shell` | `IShell` | OS integration, encryption, version |
| `app.ui` | `IUserInterface` | Dialogs, notifications |
| `app.downloads` | `IDownloads` | Download tracking |
| `app.menuFolders` | `IMenuFolders` | Sidebar folder shortcuts |
| `app.pages` | `PagesModel` | Page/tab collection, lifecycle |

Type definitions live in `/src/renderer/api/types/*.d.ts` and serve triple duty:
1. TypeScript compilation contracts
2. Monaco IntelliSense for user scripts (auto-copied to `assets/editor-types/`)
3. Documentation via JSDoc comments

## Bootstrap Sequence

Each renderer window bootstraps via `src/renderer.tsx`:

```
1. app.init()          ──  Fetch version from main process
2. app.initSetup()     ──  Configure Monaco (themes, languages, types)
3. import(index)       ──  Load main bundle, register editors
4. app.initServices()  ──  Load all Object Model interfaces (settings, fs, ui, ...)
5. app.initPages()     ──  Restore persisted pages, handle CLI args
6. app.initEvents()    ──  Subscribe to global/keyboard/IPC events, init MCP handler
7. api.windowReady()   ──  Signal main process → window shown
8. React renders       ──  UI appears with pages ready
```

Steps 1-3 run in parallel. Steps 4-7 are sequential (each depends on the previous).

## Renderer Architecture

```
/src/renderer/
├── api/              # Object Model — application interfaces
├── ui/               # Application shell (layout, tabs, sidebar, dialogs)
├── editors/          # ALL editor implementations (lazy-loaded)
├── scripting/        # Script execution engine and API wrappers
├── components/       # Reusable UI components
├── core/             # State primitives and utilities
├── theme/            # Colors, icons, theme definitions
└── types/            # Global type declarations
```

### Layer Responsibilities

| Layer | Responsibility | Key files |
|-------|---------------|-----------|
| **api/** | Object Model interfaces + implementations | `app.ts`, `settings.ts`, `fs.ts`, `pages/`, `internal/`, `types/` |
| **ui/** | Application shell, tabs, sidebar, dialogs | `MainPage.tsx`, `PageTabs.tsx`, `MenuBar.tsx`, `Dialogs.tsx` |
| **editors/** | File type handling, content editing | `registry.ts`, `text/`, `grid/`, `browser/`, etc. |
| **scripting/** | Script sandbox, API wrappers, facades | `ScriptRunner.ts`, `ScriptContext.ts`, `api-wrapper/` |
| **components/** | Reusable UI building blocks | `basic/`, `data-grid/`, `overlay/`, `virtualization/` |
| **core/** | State primitives, utilities | `state/` (TOneState, TModel), `utils/` |
| **theme/** | Design tokens, themes | `color.ts`, `themes/` |

### Dependency Rules

1. **`core/`** is the foundation — no imports from other renderer layers
2. **`components/`** is reusable — imports only `core/` and `theme/`
3. **`api/`** implements the Object Model — imports `core/`, uses IPC
4. **`editors/`** implement page types — import `core/`, `components/`, `api/`
5. **`scripting/`** wraps `api/` and `editors/` for safe script access
6. **`ui/`** orchestrates everything — imports all layers
7. Lower layers must NOT import from higher layers

## Key Subsystems

### 1. State Management

See [state-management.md](./state-management.md).

- Custom reactive primitives in `core/state/` (TOneState, TModel, TComponentModel)
- Object Model interfaces in `api/` use these primitives internally
- ContentViewModel pattern for editor view state with ref-counting

### 2. Editor System

See [editors.md](./editors.md).

- All editors in `/editors/` — 16 editor folders
- Two categories: **content-views** (share TextFileModel) and **page-editors** (standalone)
- `PageModel` base class for state, `ContentViewModel` for view state
- Dynamic loading via `import()` for code splitting
- Scripting facades expose editor APIs via `page.asX()` methods

### 3. Scripting System

See [scripting.md](./scripting.md).

- JavaScript/TypeScript execution with `page` and `app` globals
- TypeScript transpilation via sucrase (lazy-loaded, type stripping only)
- Full Node.js and React access for scripts
- API wrappers (AppWrapper, PageWrapper) provide safe, typed access
- Editor facades (TextEditorFacade, GridEditorFacade, etc.) for typed editor operations
- Auto-release of ViewModels on script completion
- Monaco IntelliSense via `.d.ts` files

### 4. MCP Integration (Model Context Protocol)

- External AI agents (Claude Desktop, Claude Code) control js-notepad via a Streamable HTTP MCP server
- Protocol: MCP over HTTP at `http://127.0.0.1:{port}/mcp` (default port 7865)
- Main process: `mcp-http-server.ts` accepts connections using `@modelcontextprotocol/sdk`, forwards requests to renderer via IPC
- Renderer process: `mcp-handler.ts` dispatches 9 commands (`execute_script`, `list_pages`, `get_page_content`, `get_active_page`, `create_page`, `set_page_content`, `get_app_info`, `open_url`, `ui_push`)
- Multi-window support: all tools accept optional `windowIndex` parameter (defaults to first open window). `list_windows` tool runs in main process (no IPC) to discover windows and their status. `open_window` tool reopens closed windows with persisted pages.
- Log View integration: `ui_push` tool pushes log entries, dialogs, and output items to a managed Log View page. Tracks an "active MCP log page" per window (auto-creates on first call, reuses on subsequent calls). Dialog entries block until user responds (infinite IPC timeout). This is the recommended output channel for AI agents.
- MCP resources: focused guides (`assets/mcp-res-*.md`) exposed as `notepad://guides/ui-push`, `notepad://guides/pages`, `notepad://guides/scripting`, plus `notepad://guides/full` (concatenated). Server instructions provide immediate context on connection.
- Opt-in via `mcp.enabled` setting — server starts/stops dynamically based on setting changes
- Port is configurable via `mcp.port` setting (default `7865`)
- Script execution uses `ScriptRunner.runWithCapture()` for headless operation with console capture
- Status broadcasting: main process pushes `eMcpStatusChanged` events to all windows on server start/stop and session connect/disconnect — renderer `Window` class holds reactive `mcpRunning`/`mcpClientCount` state, UI shows a title-bar indicator

### 5. Theming System

- CSS Custom Properties — `color.ts` returns `var()` references, theme definitions set actual values on `:root`
- 55+ component files import `color` unchanged — zero migration when adding themes
- Theme definitions in `src/renderer/theme/themes/` (one file per theme, 9 themes)
- Monaco editor has separate theme integration via `onMonacoThemeChange` callback
- Startup: synchronous `fs.readFileSync` + inline `<script>` in `index.html` for flash-free startup

## Design Principles

### 1. Core First
Keep the core text editing experience fast and lightweight. Heavy features load on-demand.

### 2. Async Imports for Editors
```typescript
// CORRECT - async import preserves code splitting
const getPdfModule = async () =>
    (await import("../editors/pdf/PdfViewer")).default;

// WRONG - synchronous import increases main bundle
import { PdfViewer } from "../editors/pdf/PdfViewer";
```

### 3. Container with Building Blocks
js-notepad provides UI building blocks (toolbar, editors, grouped pages). Users bring their own integrations via Node.js/npm — the app doesn't need built-in database or API integrations.

### 4. Consistent Editor Structure
Every editor follows the same pattern:
```
/editors/[name]/
├── index.ts              # Exports
├── [Name]Editor.tsx      # View component (or [Name]View.tsx / [Name]PageView.tsx)
├── [Name]PageModel.ts    # State & logic (page-editors)
├── [Name]ViewModel.ts    # View state (content-views with their own view model)
└── components/           # Editor-specific (optional)
```

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React Component | PascalCase.tsx | `TextEditor.tsx` |
| Model/State | PascalCase.ts | `PagesModel.ts`, `GridViewModel.ts` |
| Utility | kebab-case.ts | `csv-utils.ts` |
| Types | kebab-case.d.ts | `page.d.ts`, `settings.d.ts` |
| Index | index.ts | `index.ts` |

## Related Documentation

- [Folder Structure](./folder-structure.md) — Detailed folder organization
- [Editors](./editors.md) — Editor system architecture
- [Browser Editor](./browser-editor.md) — Multi-process browser editor
- [State Management](./state-management.md) — State patterns and primitives
- [Scripting](./scripting.md) — Script execution and API wrappers
- [Pages Architecture](./pages-architecture.md) — Pages lifecycle and submodels
