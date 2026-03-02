# Interface Objects — High-Level Catalog

This document defines the interface objects of the App Object Model from first principles.
Not a mapping of existing code — an ideal design for a scriptable, AI-controllable editor application.

See [architecture.mmd](architecture.mmd) for the visual diagram.

---

## Architecture Layers

### 1. Consumers
Who uses the Object Model. All consumers access the same interface objects.

| Consumer | How they access | Notes |
|----------|----------------|-------|
| **App UI** (React) | React hooks (`useApp`, `usePage`) | Reactive — re-renders on state changes |
| **Scripts** (F5/Panel) | Global variables (`app`, `page`) | Imperative — runs top-to-bottom |
| **AI Bot** (Claude) | Tool adapter (flat function calls) | Each interface method becomes an AI tool |
| **Plugins** (webview) | Plugin bridge (`postMessage` API) | Sandboxed, async-only |

### 2. Access Adapters
Thin wrappers that adapt the Object Model for each consumer type:

- **React Hooks** — Subscribe to state, trigger re-renders. `usePage()` returns reactive IPage.
- **Script Context** — Injects `app` and `page` as globals. `page` may be `null` if script has no page context.
- **Tool Adapter** — Flattens hierarchical API into tool descriptions for AI. `app.pages.close(page)` → `close_page(pageId)`.
- **Plugin Bridge** — Serializes calls over `postMessage`. Async-only. Security boundary.

### 3. Object Model (this document)
The public API. All interface objects described below.

### 4. Platform Services
Cross-process service pairs (renderer API ↔ backend controller). Power the Object Model but are not directly exposed to consumers. Each service encapsulates a domain of renderer↔main communication.

### 5. Infrastructure
Low-level primitives: reactive state, event system, IPC transport, editor registry with lazy loading.

### 6. Main Process
Backend controllers that handle native operations. Electron APIs, Node.js, OS integration.

---

## Root: `app` — IApp

The single entry point to the entire application.

**Role:** Aggregates all core service interfaces. The root of the object hierarchy.

**Sub-interfaces:**

| Property | Interface | Description |
|----------|-----------|-------------|
| `app.pages` | IPageCollection | Workspace — all open documents/tabs |
| `app.ui` | IUserInterface | User interaction — dialogs, notifications, sidebar |
| `app.settings` | ISettings | Application configuration |
| `app.fs` | IFileSystem | File system operations |
| `app.window` | IWindow | Window management |
| `app.editors` | IEditorRegistry | Available editor types, language mapping |
| `app.recent` | IRecentFiles | Recent file history |
| `app.shell` | IShell | OS integration, spawn, and sub-services |
| `app.downloads` | IDownloads | Global download tracking |

**Direct properties:** `version`

---

## Core Service Interfaces

### `app.pages` — IPageCollection

**Role:** Workspace management. All open documents (tabs) — create, open, close, find, navigate, group.

**Key concepts:**
- Owns the collection of all open pages
- Tracks active page (the one currently visible)
- Manages grouping (side-by-side pages)
- Manages tab order and pinning
- Emits events on page lifecycle changes

**Capabilities:**
- Access: active page, all pages, count
- Find: by id, by file path, by predicate
- Lifecycle: open file, create empty, create with specific editor, close, close all
- Navigation: show page, next, previous
- Organization: group, ungroup, move, pin, unpin
- Events: page opened, page closed, active changed

**Notes:**
- `open(filePath)` is async — resolves editor type, loads module, reads file
- `create()` is sync — creates empty text page immediately
- `close()` is async — may prompt user to save unsaved changes
- Pages are identified by id (string), not by index

---

### `app.ui` — IUserInterface

**Role:** All user interaction that doesn't belong to a specific page. Dialogs, notifications, status bar, progress indicators.

**Key concepts:**
- Modal dialogs (message, confirm, input, pick)
- Non-modal notifications (toast/snackbar)
- Status bar information
- Progress reporting for long operations

**Capabilities:**
- Dialogs: show message, confirm (yes/no), input (text), pick (select from list)
- Notifications: show toast with type (info, warning, error)
- Status: set status bar text, show/hide progress
- Progress: create progress handle for long-running operations

**Notes:**
- All dialog methods are async (wait for user response)
- Notifications are fire-and-forget
- AI bot uses dialogs to ask the user questions
- Scripts use dialogs for interactive workflows

---

### `app.settings` — ISettings

**Role:** Application configuration. Read and write settings, react to changes.

**Key concepts:**
- Key-value store with typed access
- Persisted to disk automatically
- Change events for reactive updates
- Some settings have side effects (e.g., theme change applies immediately)

**Capabilities:**
- Read/write: get, set (by string key, typed)
- Convenience: typed accessors for common settings (theme, etc.)
- Events: setting changed

---

### `app.fs` — IFileSystem

**Role:** File system operations. Abstracts file I/O and system dialogs.

**Key concepts:**
- Read/write files with encoding support
- File existence and deletion
- System open/save dialogs
- Path utilities

**Capabilities:**
- File I/O: read, write, exists, delete
- Dialogs: open file dialog, save file dialog, open folder dialog
- Paths: resolve, join, basename, extension helpers

**Notes:**
- All I/O methods are async
- Dialogs are async (user interaction)
- This is a cross-process interface — dialogs run in main process

---

### `app.window` — IWindow

**Role:** Application window management.

**Key concepts:**
- Window state (minimized, maximized, normal, fullscreen)
- Window actions (minimize, maximize, restore, close)
- Multi-window support (open new window, list windows)

**Capabilities:**
- State: current state, is focused
- Actions: minimize, maximize, restore, close, toggle fullscreen
- Multi-window: open new window, move page to another window

**Notes:**
- Cross-process — backed by main process window controller
- Close may be blocked by unsaved pages (delegates to `app.pages`)

---

### `app.editors` — IEditorRegistry

**Role:** Registry of available editor types and their capabilities.

**Key concepts:**
- Each editor type has an id, name, category, and supported file patterns
- Editors are lazy-loaded modules
- Scripts/AI can query what editors are available
- Useful for creating pages with a specific editor

**Capabilities:**
- Query: list all editors, find by id, find by file pattern
- Info: name, category (page-editor vs content-view), supported languages
- Resolution: which editor handles a given file?

**Notes:**
- Read-only for scripts/AI (editors are registered at app startup, not dynamically)
- Useful for discovery: "what editors can open JSON files?"
- Also owns language mapping (extension → language id)

---

### `app.recent` — IRecentFiles

**Role:** Recent file history.

**Key concepts:**
- Ordered list of recently opened file paths
- Add on file open, remove on demand, clear all

**Capabilities:**
- List: get all recent files (ordered by recency)
- Manage: add, remove, clear

**Notes:**
- Simple interface. Small but useful for scripts/AI to discover what the user has been working on.

---

### `app.shell` — IShell

**Role:** OS integration and utility services. Anything that interacts with the operating system or provides standalone functionality not tied to a specific page.

**Key concepts:**
- Direct OS interaction (explorer, spawn processes, open URLs externally)
- Sub-services for complex operations (file search, version, encryption, scripting)
- One-liner convenience wrappers for common tasks

**Capabilities:**
- OS: show in file explorer, open folder, open URL in default browser
- Process: spawn command and get result (stdout/stderr)
- Browser registration: register/unregister as default browser
- Sub-services (see below)

**Sub-services:**

#### `app.shell.fileSearch` — IFileSearchService

Search file content across folders.
- `search(query, folder, options)` — find text in files, returns matches

#### `app.shell.version` — IVersionService

App version and update information.
- `appVersion` — current version string
- `runtimeVersions` — Electron, Node, Chrome versions
- `checkForUpdates()` — check for new version, return update info

#### `app.shell.encryption` — IEncryptionService

Content encryption/decryption (AES-GCM).
- `encrypt(content, password)` → encrypted string
- `decrypt(content, password)` → decrypted string

#### `app.shell.scripting` — IScriptingService

Execute JavaScript programmatically (used by AI bot).
- `run(code, page?)` — execute code in script context, return result
- Useful for AI bot to run arbitrary transformations

**Notes:**
- `app.shell.spawn()` is intentionally simple — run command, get result. For complex process management, use Node.js directly in scripts.
- Sub-services are always available (not lazy-loaded). They are grouped under `app.shell` because they represent "system-level" functionality.

---

## Page Interface: `page` — IPage

**Role:** A single open document/tab. The central object that scripts interact with.

**Key concepts:**
- Common interface for ALL page types (text, browser, grid, pdf, etc.)
- Content access for text-based pages
- Metadata: file path, title, language, editor type
- Persistent data storage per page (for scripts)
- Grouping: link two pages side-by-side
- Editor-specific capabilities via async accessors (`asText()`, `asBrowser()`, etc.)

**Capabilities:**
- Identity: id, type, file path, title
- Content: read/write text content, language, editor type
- State: modified flag, pinned flag
- Data: persistent key-value storage (survives script reruns)
- Grouping: access grouped page, check if grouped
- Tab: pin, unpin
- Lifecycle: close, save, save as
- Specialization: asText(), asBrowser(), asGrid(), asMarkdown(), asNotebook()

**Notes:**
- `content` getter/setter works for text-based pages; returns empty string for binary pages (pdf, image)
- `grouped` returns the paired page or null; accessing `page.grouped` does NOT auto-create (unlike current behavior — auto-creation moves to an explicit method)
- Editor-specific accessors (`asText()`, etc.) are async because they may trigger lazy module loading
- `asText()` on a non-text page throws or returns null — TBD per error handling strategy

---

## Editor-Specific Interfaces (Lazy-Loaded)

These extend `IPage` with editor-specific capabilities. Loaded on demand via `page.asXxx()`.

### ITextEditor (via `page.asText()`)

**Role:** Text editing operations — Monaco editor access.

**Key concepts:**
- Cursor and selection management
- Find and replace
- Line-level operations
- Script panel access

**Capabilities:**
- Selections: get/set cursor position, get/set selections
- Text operations: insert at position, get line, line count
- Find/replace: find matches, replace
- Script panel: access related script, run script

---

### IBrowserEditor (via `page.asBrowser()`)

**Role:** Web browser operations.

**Key concepts:**
- Multi-tab browsing within one page
- Navigation (URL, back, forward, reload)
- Tab management (open, close, switch)
- Bookmarks access
- Downloads (initiated by page clicks)
- Search engines, find in page, profiles

**Capabilities:**
- Navigation: navigate to URL, back, forward, reload, stop, go home
- URL: current URL, page title
- Tabs: list tabs, active tab, open/close/switch tabs
- Content: get page source, execute JavaScript in page
- Bookmarks: access bookmarks for this profile, toggle bookmark, is bookmarked
- Downloads: list of downloads with cancel/open/showInFolder
- Find: open/close find bar, find next/previous
- Search engine: get/set search engine
- Profile: profile name, is incognito
- Audio: mute/unmute
- DevTools: open developer tools

---

### IGridEditor (via `page.asGrid()`)

**Role:** Structured data grid (JSON/CSV).

**Key concepts:**
- Row/column data model
- Sorting and filtering
- Cell-level read/write

**Capabilities:**
- Data: rows, columns, row count
- Operations: sort by column, filter
- Cell access: get/set cell value
- Selection: selected rows, selected cells

---

### IMarkdownEditor (via `page.asMarkdown()`)

**Role:** Markdown preview operations.

**Key concepts:**
- Rendered preview control
- Search within rendered content
- Scroll synchronization

**Capabilities:**
- Preview: scroll to heading, search in preview
- Export: rendered HTML content

---

### INotebookEditor (via `page.asNotebook()`)

**Role:** Structured notebook (categories, items, tags).

**Key concepts:**
- Category/item hierarchy
- Tags and filtering
- Item CRUD

**Capabilities:**
- Categories: list, create, rename, delete
- Items: list, create, update, delete, move
- Tags: list, create, filter by tag
- Search: find items by text

---

### ITodoEditor (via `page.asTodo()`)

**Role:** Structured task list.

**Key concepts:**
- Todo items with check/uncheck
- Categories and tags
- Drag-to-reorder

**Capabilities:**
- Items: add, remove, toggle, edit, move
- Categories: add, group by category
- Tags: add, filter by tag
- Search: find items by text

---

### ILinksEditor (via `page.asLinks()`)

**Role:** Structured link/bookmark manager.

**Key concepts:**
- Links organized in folders
- Favicon display
- Multiple view modes

**Capabilities:**
- Links: add, remove, edit, move between folders
- Folders: create, rename, delete
- View: switch view mode (list, tiles)

---

## Platform Services (Internal)

These are NOT directly exposed in the Object Model — they power the interface objects behind the scenes. Each is a renderer↔main service pair.

| Service | Renderer Side | Main Side | Powers |
|---------|--------------|-----------|--------|
| **File Service** | Requests file I/O, dialogs | Handles fs calls, shows native dialogs | `app.fs` |
| **Window Service** | Requests window actions | Controls BrowserWindow | `app.window` |
| **Download Service** | Tracks downloads, shows UI | Manages download items | `app.downloads` (IDownloads) |
| **Search Service** | Requests file search | Indexes and streams results | `app.shell.fileSearch` |
| **Browser Service** | Manages webview state | Bridges webContents events | `IBrowserEditor` |
| **Version Service** | Displays update info | Checks GitHub releases | `app.shell.version` |

---

## Object Relationships Summary

```
app (IApp)
├── pages (IPageCollection)
│   ├── active ──→ page (IPage)
│   ├── all ────→ page[] (IPage[])
│   ├── open() ─→ page (IPage)
│   └── events: onPageOpened, onPageClosed, onActiveChanged
│
├── ui (IUserInterface)
│   ├── showMessage(), showConfirm(), showInput()
│   ├── showNotification()
│   └── folders (sidebar shortcuts)
│
├── settings (ISettings)
│   ├── get(), set()
│   └── events: onChanged
│
├── fs (IFileSystem)
│   ├── read(), write(), exists(), delete()
│   └── showOpenDialog(), showSaveDialog()
│
├── window (IWindow)
│   ├── minimize(), maximize(), restore(), close()
│   └── state, isFocused, zoom
│
├── editors (IEditorRegistry)
│   ├── list(), findById(), resolve()
│   └── editor info, language mapping
│
├── recent (IRecentFiles)
│   └── files[], add(), remove(), clear()
│
└── shell (IShell)
    ├── showInFolder(), openExternal(), spawn()
    ├── registerAsDefaultBrowser()
    ├── fileSearch (IFileSearchService)
    │   └── search(query, folder, options)
    ├── version (IVersionService)
    │   └── appVersion, runtimeVersions, checkForUpdates()
    ├── encryption (IEncryptionService)
    │   └── encrypt(), decrypt()
    └── scripting (IScriptingService)
        └── run(code, page?)

page (IPage)
├── identity: id, type, filePath, title
├── content: content, language, editor, modified
├── data: persistent key-value store
├── grouping: grouped, isGrouped
├── tabs: pinned, pin(), unpin()
├── lifecycle: close(), save(), saveAs()
│
├── asText() ──→ ITextEditor
│   ├── selections, lineCount
│   ├── find(), replace(), insertAt()
│   └── getLine(), setSelection()
│
├── asBrowser() ──→ IBrowserEditor
│   ├── currentUrl, tabs, downloads
│   ├── navigate(), back(), forward(), reload()
│   ├── bookmarks, find, searchEngine, profile
│   └── getSource(), executeScript()
│
├── asGrid() ──→ IGridEditor
│   ├── rows, columns
│   ├── sort(), filter()
│   └── getCell(), setCell()
│
├── asMarkdown() ──→ IMarkdownEditor
│   └── scrollToHeading(), search(), getHtml()
│
├── asNotebook() ──→ INotebookEditor
│   ├── categories, items, tags
│   └── createItem(), updateItem(), deleteItem()
│
├── asTodo() ──→ ITodoEditor
│   └── items, add(), toggle(), categories, tags
│
└── asLinks() ──→ ILinksEditor
    └── links, folders, add(), remove(), move()
```
