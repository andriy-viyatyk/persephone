[← Home](./index.md)

# What's New

Release notes and changelog for js-notepad.

---

## Version 1.0.18 (Upcoming)

### New Features

- **Library Imports in Scripts** — Use `require("library/...")` to import reusable modules from your linked Script Library folder
  - Both `.ts` and `.js` files supported — TypeScript is transpiled automatically
  - Extension auto-resolution: `.ts`, `.js`, `/index.ts`, `/index.js` tried automatically
  - Relative requires within library modules work (e.g., `require('./db-config')`)
  - Cache invalidated between runs when source files change
  - Clear error message when no library folder is linked

- **Script Library** — A dedicated sidebar entry for quick access to your reusable script collection
  - Link any folder as your Script Library via the sidebar or Settings → Script Library
  - Browse and open scripts from the sidebar's right panel (File Explorer view)
  - Context menu: Change Library Folder, Open in Explorer, Unlink Library
  - Settings page section with path display, Browse button, and Unlink button

- **IntelliSense for Library Modules** — When a Script Library folder is linked, Monaco now provides autocomplete and type information for `require("library/...")` calls
  - Exported functions, variables, and types from library `.ts`/`.js` files appear in autocomplete with parameter types, return types, and JSDoc documentation
  - Updates live when library files are modified
  - Built-in `require()` and `preventOutput()` also show in autocomplete with documentation

### Improvements

- **Structured Editor Auto-Detection** — JSON content created via MCP or scripting now embeds a `type` property (`"note-editor"`, `"todo-editor"`, or `"link-editor"`), so the correct editor switch button (Notebook, ToDo, or Links) appears in the toolbar automatically — even without the `.note.json`/`.todo.json`/`.link.json` file extension

---

## Version 1.0.17

### New Features

- **AI Agent Integration (MCP HTTP Server)** — external AI agents (such as Claude Desktop, Claude Code, ChatGPT, or Gemini) can now connect to js-notepad and control it programmatically via HTTP
  - Server listens on `http://localhost:7865/mcp` (port is configurable via the `mcp.port` setting)
  - Connect any MCP-compatible client by pointing it to the server URL
  - Dedicated **MCP Server** section in Settings with enable/disable toggle, port input, live status indicator (green/red dot), **Copy URL** and **Copy Config** buttons
  - Disabled by default — enable with a single checkbox in Settings → MCP Server
  - Port is configurable in Settings (default: `7865`); disable MCP first, change the port, then re-enable
  - Server is bound to localhost only (127.0.0.1) and is not accessible from other machines
  - Available tools: `execute_script`, `list_pages`, `get_page_content`, `get_active_page`, `create_page`, `set_page_content`, `get_app_info`
  - Console output (`console.log`, `console.error`, etc.) from scripts executed via MCP is captured and returned to the agent
  - **API Guide resource** (`notepad://docs/api-guide`) — AI clients can read a condensed scripting API reference directly from the MCP server, giving standalone clients (Claude Desktop, ChatGPT, Gemini) the context they need to use js-notepad effectively without any project setup
  - **Title bar MCP indicator** — when the MCP server is active, a small indicator (green dot + "MCP" label) appears in the title bar with a live connection count; hidden when MCP is disabled
  - **Multi-window support** — all MCP tools accept an optional `windowIndex` parameter to target specific windows. New `list_windows` tool discovers all windows (open and closed) with their pages. New `open_window` tool reopens closed windows with their persisted pages
  - See [MCP Server Setup](./mcp-setup.md) for configuration instructions

- **TypeScript Script Execution** — scripts now support TypeScript in addition to JavaScript
  - Write scripts with type annotations (interfaces, typed variables, etc.) — types are stripped automatically before execution
  - The Script Panel uses TypeScript by default, accepting both plain JavaScript and TypeScript seamlessly
  - Press `F5` on `.ts` files to execute them, just like `.js` files
  - Notebook notes with TypeScript language show a Run button and can be executed
  - **Quick Add: Script (TS)** — new option in the tab bar's "+" dropdown menu to create a TypeScript script page
  - MCP `execute_script` tool accepts an optional `language` parameter (`"javascript"` or `"typescript"`)

- **Text Dialog** — new `app.ui.textDialog()` method that opens a Monaco-based dialog for displaying or editing multi-line text
  - Configurable title, buttons, read-only mode, and dialog dimensions
  - Monaco editor options: language for syntax highlighting, word wrap, minimap, line numbers
  - Useful for showing error details, editing SQL queries, reviewing logs, or getting multi-line input from scripts

- **Output Suppression** — scripts can now prevent the default output to the grouped page
  - Call `preventOutput()` to explicitly suppress output (e.g., when showing results in a dialog)
  - Writing to `page.grouped.content` directly now automatically suppresses default output
  - When output is suppressed and an error occurs, the error is shown in a text dialog instead

- **`page.runScript()`** — new method to programmatically run a JavaScript/TypeScript page as a script (equivalent to pressing F5), returning the result as text

### Improvements

- **Todo Editor Scripting** — 4 new methods on the `asTodo()` facade: `selectList(name)`, `selectTag(name)`, `setSearch(text)`, `clearSearch()` — allowing scripts and MCP agents to navigate and filter the todo UI programmatically

- **MCP `create_page` Editor Validation** — passing an invalid editor ID to `create_page` now returns a descriptive error with the list of valid editor IDs, instead of silently failing

- **MCP Lazy Loading** — the MCP SDK is now loaded on-demand when the server starts, rather than at app startup. Combined with a 1.5s deferred auto-start, this improves application launch time for all users

- **Markdown Preview — Mermaid "Open in Editor"** — hover over an inline mermaid diagram to see a toolbar with two buttons: copy image to clipboard, and open the diagram source in a new Mermaid editor tab

- **External Link Routing** — external links now prefer the active browser page when one is available. Empty browser tabs (`about:blank`) are reused instead of opening a new tab

- **Image Viewer — Save Image to File** — URL-based images now have a "Save Image to File" button in the toolbar that downloads the image and saves it to disk, then switches to file mode

- **Link Editor — Image URL Clear Button** — the Image URL field in the Edit Link dialog now has a clear (X) button for quickly removing the image

- **Monaco Minimap Click** — clicking on the minimap background now scrolls directly to that position in the document

- **Auto-Hiding Scrollbars** — tree views and grids now use VSCode-like auto-hiding scrollbars that appear on hover, reducing visual clutter

- **Sidebar Folder Double-Click** — double-clicking a folder in the sidebar now opens it in a NavigationPanel tab

### Bug Fixes

- **NavigationPanel Folder State** — fixed expanded folder state being lost on first navigation in NavigationPanel

---

## Version 1.0.16

### New Features

- **Browser Editor — Download Manager** — download progress tracking and history in the browser toolbar
  - **Download button** with circular progress ring that animates while downloads are active (icon turns active color)
  - Click the button to open a **Downloads popup** listing all downloads (most recent first)
  - Active downloads show a progress bar with received/total bytes and a **Cancel** button
  - Completed downloads show **Open** (launches file with default app) and **Show in Folder** (opens Explorer with file selected) buttons
  - Failed or cancelled downloads display status text
  - **Clear** button to dismiss completed and failed entries
  - Global download list — shared across all browser pages and windows
  - Last 5 completed downloads are persisted and restored on app restart
  - Uses the native OS save dialog for choosing download location

### Improvements

- **Browser Editor — Find in Page** — `Ctrl+F` now opens a proper inline search bar (replacing the `prompt()` dialog):
  - Match counter showing "3 of 15" or "No results"
  - Next/Previous navigation with `Enter`/`Shift+Enter` or `F3`/`Shift+F3`
  - Close with `Escape` or close button — clears all highlights
  - Works when focus is inside the web page (via main process key interception)
  - Auto-closes on page navigation or tab switch

- **Browser Editor — Keyboard Shortcuts** — standard browser hotkeys now work regardless of focus location:
  - `F5` — Reload page
  - `Ctrl+F5` / `Ctrl+Shift+R` — Hard reload (bypass cache)
  - `Ctrl+R` — Reload (alias)
  - `F12` — Open DevTools
  - `Alt+Left` / `Alt+Right` — Back / Forward
  - `Alt+Home` — Navigate to the tab's home page
  - `Escape` — Stop loading

- **Browser Editor — Automatic Cache Cleanup** — when a browser page is closed, HTTP cache, compiled code cache, and service worker caches are automatically cleared to save disk space. Cookies, localStorage, and other site data are preserved so you stay logged in.

- **Browser Editor — Popup Blocking** — sites that try to spam popup windows or internal tabs are now rate-limited (max 3 within 2 seconds). A notification bar appears when popups are blocked, with an "Allow" button to temporarily permit popups for that page.

- **Link Editor — Browser Selector Button** — toolbar button to choose where links open: OS default browser, internal browser, a specific browser profile, or incognito mode. Initialized from the app setting, adjustable per session.

- **Link Editor — Hostnames Panel** — new collapsible panel in the sidebar showing hostnames extracted from all links, allowing quick filtering by hostname.

- **Link Context Menu — Browser Profiles** — right-click context menu on links in Link Editor, Markdown Preview, and pinned links now includes all configured browser profiles (not just Default/Internal/Incognito).

- **Link Editor — Session State Persistence** — selected category, tag, hostname, and expanded panel are remembered across app restarts (restored when reopening the same file).

- **Todo Editor — Session State Persistence** — selected list and tag are remembered across app restarts.

- **Pinned Tab Tooltip** — hovering over a pinned tab now shows the full file path in a tooltip (with a 1.5s delay), making it easy to identify pinned files without unpinning them.

- **Lightweight Launcher** — new `js-notepad-launcher.exe` (308KB Rust binary) for near-instant file opening via Named Pipe. When js-notepad is already running, files and URLs are delivered in under 50ms instead of ~1 second. Supports file paths, URLs, relative paths, and diff mode for Git Extensions integration.

- **Register as Default Browser** — js-notepad can now register itself as a Windows default browser, so clicking links in other applications (email, chat, documents) opens them in js-notepad's built-in browser editor.
  - **Settings → Default Browser** section with Register / Unregister buttons and status indicator
  - "Open Windows Default Apps" button navigates directly to the JS-Notepad page in Windows Settings
  - Registry keys written to HKCU (no admin required)
  - URLs from the OS always open in the internal browser tab using the default profile
  - Works on cold start and when js-notepad is already running (via the launcher's named pipe)

- **NSIS Installer** — production builds now use electron-builder with a custom NSIS installer featuring an options page: desktop/start menu shortcuts, Explorer context menu ("Open with js-notepad"), file associations, and browser registration.

### Bug Fixes

- **Default Browser — External URL Routing** — fixed an issue where clicking links in external applications (when js-notepad is the default browser) could create duplicate browser pages instead of reusing the existing one. External URLs now correctly find the first browser page with the default profile and add a new internal tab there.

---

## Version 1.0.15

### Improvements

- **Link Editor Enhancements**
  - **Favicons** — cached favicons from the internal browser displayed next to links in list view and as tile fallback; favicons also saved when opening links via "Open in Internal Browser" from standalone `.link.json` files
  - **Drag-and-drop** — drag links onto categories to reassign them; drag categories onto other categories to reparent (with confirmation dialog showing affected link count)
  - **Pinned links panel** — pin important links via right-click → "Pin"; pinned panel on the right edge shows favicon + title, auto-hides when empty, resizable via splitter, with drag-to-reorder support

---

## Version 1.0.14

### New Features

- **Browser Bookmarks** — Per-profile bookmark management integrated into the browser editor
  - **Star button (☆)** in the URL bar for quick bookmarking
    - Empty star when URL is not bookmarked; filled star when already bookmarked
    - Click to open Edit Link Dialog with URL and title prefilled
    - Discovered images from page meta tags and click tracking available for selection
  - **Bookmarks panel** — "Open Links" toolbar button opens a sliding overlay drawer with the full Link Editor
    - Right-anchored overlay with semi-transparent backdrop
    - Browse, search, edit, and manage all bookmarks with categories, tags, and multiple view modes
    - Click a link to navigate (opens in current tab if blank, otherwise new internal tab)
    - Resizable panel (initial width 60%, max 90%), Categories/Tags panel on the right
    - Closes on Escape, backdrop click, or after link click navigation
  - **Context menu bookmarking** — right-click a link or tile on a web page → "Add to Bookmarks" with captured URL, title, and image
  - **Image discovery** — collects candidate images from multiple sources:
    - Page meta tags (`og:image`, `twitter:image`, etc.)
    - Images inside clicked `<a>` elements (captured before navigation)
    - "Use Image for Bookmark" context menu on right-clicked images
    - Per-tab image tracking with navigation levels (remembers images from previous pages)
  - **Per-profile bookmarks files** — each browser profile (Default, named, Incognito) can have its own `.link.json` bookmarks file, configured in **Settings → Browser Profiles**
  - Bookmarks fully functional in incognito mode
  - Supports encrypted `.link.json` files with async password dialog
  - All edits auto-save to the bookmarks file

### Improvements

- **Async Password Dialog** — The file encryption/decryption password prompt is now a standalone async dialog (`showPasswordDialog`) that can be used from any code path, replacing the previous inline panel in the text editor. Same dialog pattern as other app dialogs (confirmation, input).

---

## Version 1.0.13

### New Features

- **Browser Editor** — Browse the web directly in a js-notepad tab
  - Open via the dropdown arrow next to the **+** button → **Browser**
  - URL bar with Enter to navigate; plain text searches Google automatically
  - Back, Forward, Reload/Stop navigation buttons
  - **Home button** — each tab remembers its "home" URL (first URL navigated to); click to return
  - **Internal tabs** — multiple browser tabs within a single js-notepad tab
    - Left-side tabs panel with favicon and title (starts collapsed to icon-only mode)
    - `target="_blank"` links open as new internal tabs; `window.open()` from JavaScript opens real popup windows (preserving OAuth/auth flows)
    - Close Tab button in toolbar; new tab button at the bottom of the tabs panel
    - Tab context menu: Close Tab, Close Other Tabs, Close Tabs Below
    - Resizable tabs panel with splitter (transparent, minimal visual weight)
    - Active tab styled with dark background and blue border
    - **Compact mode** — when tabs panel is narrow, hovering a tab shows a floating extension popup with title and close button
    - **Audio mute** — volume icon on tabs playing audio; click to mute/unmute individual tabs or all tabs at once (page-level mute on the js-notepad tab)
    - Closing the last tab opens a fresh blank page
  - Page title and favicon displayed in the js-notepad tab
  - Loading indicator bar below the toolbar
  - Find in page with `Ctrl+F`
  - Focus URL bar with `Ctrl+L`
  - **Search engine selector** — Firefox-style engine picker in the URL bar on blank pages and search result pages
    - 11 engines: Google (default), Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, Gibiru
    - Switch engines on a search results page to re-search the same query
  - **URL suggestions dropdown** — autocomplete in the URL bar
    - On focus: shows navigation history (URLs visited in the current tab)
    - On typing: shows filtered search history with multi-word matching and highlighted matches
    - Keyboard navigation (Arrow keys, Enter, Escape)
    - "Clear" button removes visible filtered entries from search history
    - Search history persisted per profile; skipped for incognito
  - **Context menu** — right-click in the web page for contextual actions
    - On links: Open Link in New Tab, Copy Link Address
    - On images: Open Image in New Tab (opens in Image Viewer), Copy Image Address
    - On selected text: Copy; on editable fields: Cut, Copy, Paste
    - On SVG elements: Open SVG in Editor (with auto-fixed xmlns/viewBox for standalone rendering)
    - Navigation: Back, Forward, Reload
    - Developer: View Source (raw server HTML), View Actual DOM (live rendered DOM), Inspect Element
  - **URL bar** with navigate button and "Paste and Go" in right-click menu
  - **Browser Profiles** — isolated browsing sessions with separate cookies, storage, and cache
    - Create named profiles with custom colors in **Settings → Browser Profiles**
    - Each profile gets its own Electron session partition
    - Open a profiled browser via the **+** dropdown → **Browser profile...** submenu
    - Set a default profile — the **Browser** quick-add item uses it
    - Profile color shown on the page tab icon (tinted globe)
    - Change profile color by clicking the color dot in Settings
    - Clear browsing data per profile ("clear data" button)
    - Delete a profile with confirmation (also clears all data from disk)
  - **Incognito mode** — ephemeral browsing with no persistent data
    - Open via **+** dropdown → **Browser profile...** → **Incognito**
    - Incognito icon on page tab and inside the URL bar
    - Data is automatically discarded when the tab closes
  - **Link integration** — external links from editors can open in the internal browser instead of the OS default
    - New setting in **Settings → Links**: "Open in default OS browser" or "Open in internal Browser tab"
    - Smart routing: links open in the nearest browser tab (searches right, then left from the active page); creates a new one if none exists
    - Markdown Preview link context menu: "Open in Default Browser", "Open in Internal Browser", "Open in Incognito"
    - Monaco Ctrl+Click on links also respects the global setting
  - DevTools access via gear icon in toolbar
  - Session restore — all internal tabs, URLs, navigation history, and profile selection persisted across app restarts
  - Isolated storage — cookies and site data separated from the main application
  - Security: navigation to `file://` and `app-asset://` protocols is blocked

- **Link Editor** — A structured link manager for `.link.json` files
  - Organize links with **categories** (hierarchical tree) and **tags**
  - **5 view modes**: List, Landscape tiles, Landscape (Large) tiles, Portrait tiles, Portrait (Large) tiles
  - View mode remembered per category and per tag independently
  - Custom view mode icons in toolbar and mode selector menu
  - Tile views display preview images with "no image" placeholder
  - **Edit/Create dialog** with auto-growing title field, URL, category with autocomplete, tag chips with autocomplete, image URL with preview
  - Discovered images section in dialog (prepared for future browser bookmark integration)
  - **Context menu**: Edit, Open in Default Browser, Open in Internal Browser, Open in Incognito, Copy URL, Delete
  - Conditional image items: Copy Image URL, Open Image in New Tab (opens in Image Viewer)
  - Search/filter links by title or URL
  - Delete confirmation with Ctrl+click bypass
  - Double-click to edit in both list and tile views
  - Selection overlay using semi-transparent pseudo-elements
  - Distinctive file icon for `.link.json`
  - Can switch to Monaco for raw JSON editing

- **Quick Add: Links** — The dropdown menu next to the "+" tab button now includes a "Links" option to create a new `.link.json` file

---

## Version 1.0.12

### New Features

- **Search in Files** — Press `Ctrl+Shift+F` in the File Explorer panel to search file contents across the entire folder tree
  - Results streamed incrementally as files are scanned (search runs in the main process — no UI freezes)
  - Results panel below the file tree, grouped by file with matched lines and highlighted text
  - Click a result to open the file in Monaco editor at the matched line with search text highlighted
  - File tree filters to show only files with matches during active search
  - Include/exclude glob patterns for targeted searching
  - Default excludes: `node_modules`, `.git`, and other common non-source directories
  - While the search panel is open, file tree clicks activate Monaco editor instead of preview mode
  - Configurable searchable file extensions in Settings → File Search

---

## Version 1.0.11

### New Features

- **Todo Editor** — A structured task list editor for `.todo.json` files
  - Organize tasks into multiple named lists (e.g., "Project A", "Personal")
  - **Tags** — define colored tags and assign one tag per item (e.g., "bug", "feature", "critical")
  - **Tag filtering** — click a tag in the left panel to filter; combines with list filter and search (AND logic)
  - **Tag management** — add, rename, delete tags; assign colors from a predefined palette
  - Each list shows undone/total count badges
  - Quick-add input — type and press Enter to create new items
  - Checkbox toggle to mark items done/undone
  - Undone items first, done items sorted by completion date (newest first)
  - Drag-to-reorder undone items via drag handle (warnings when reorder isn't possible)
  - Optional multiline comments on any item
  - Hover to see created and done dates
  - Toolbar search with live filtering and highlighted matches
  - Inline editing of titles and comments for both done and undone items
  - Add, rename, and delete lists (with confirmation dialogs)
  - Resizable left panel with splitter
  - Virtualized item list for smooth scrolling
  - Can switch to Monaco for raw JSON editing
  - Distinctive file icon for `.todo.json` files

- **Quick Add: Todo** — The dropdown menu next to the "+" tab button now includes a "Todo" option to create a new `.todo.json` file

---

## Version 1.0.10

### New Features

- **Open Folder in New Tab** — Click the chevron icon on a selected sidebar folder to open a new tab with the File Explorer panel showing that folder's contents

- **Markdown Search** — Press `Ctrl+F` in Markdown Preview to search text
  - All matches highlighted with match counter ("3 of 17")
  - Navigate matches with `F3` / `Shift+F3` or arrow buttons
  - Active match highlighted with background color and scrolled into view
  - `Esc` or close button to dismiss

### Improvements

- **Pinned Tab Grouping** — Pinned tabs can now be grouped with other tabs for side-by-side view
  - Script execution works in pinned tabs (output goes to grouped tab as expected)
  - Duplicate Tab works for pinned tabs
  - Grouping is preserved when pinning/unpinning a tab
  - Ctrl+Click grouping between pinned and unpinned tabs works

- **Deleted File Indicator for Pinned Tabs** — The modification dot on pinned tabs now turns red when the file has been deleted from disk, matching the red title shown on normal tabs

### Bug Fixes

- **HTML Preview navigation crash** — Fixed an issue where clicking links in the HTML Preview editor could crash the application in production builds. Links in HTML Preview are now blocked from navigating.

---

## Version 1.0.9

### New Features

- **Pinned Tabs** — Keep important tabs compact and always visible
  - Right-click a tab → "Pin Tab" to pin it; "Unpin Tab" to unpin
  - Pinned tabs display as compact icon-only tabs at the left of the tab bar
  - Stay fixed in place when scrolling through other tabs (sticky positioning)
  - Cannot be closed or dragged to another window
  - Can be reordered among other pinned tabs by dragging
  - Show language icon, encryption icon, and modification dot
  - Navigate to other files via File Explorer panel while staying pinned
  - Pinned state persists across app restarts
  - Windows with pinned tabs are preserved on close (reopenable from sidebar)
  - "Close Other Tabs" and "Close Tabs to the Right" skip pinned tabs

---

## Version 1.0.8

### New Features

- **File Explorer Panel** — Browse files alongside any open document
  - Click the File Explorer button in the toolbar to open a tree-based file browser
  - Available for all file types: text, markdown, images, PDFs
  - Shows all files and folders in the same directory as the current file
  - Click any file to navigate in-place — content replaces in the same tab (no new tabs)
  - Navigated files auto-switch to preview mode (Markdown preview, SVG view, Mermaid diagram, etc.)
  - Full file operations via context menu: create files/folders, rename, delete
  - Open in New Tab, Show in File Explorer, Copy File Path
  - Navigate up to parent folder or make any subfolder the new root (context menu or double-click)
  - Collapse all expanded folders with a single click
  - Search files with Ctrl+F within the panel
  - Lazy-loading folder expansion for large directories
  - Resizable panel with splitter, state persists across app restarts
  - Scroll position preserved when navigating between files

- **Application Theming** — Switch between 9 color themes (6 dark, 3 light) via the new Settings page
  - Dark themes: Default Dark, Solarized Dark, Monokai, Abyss, Red, Tomorrow Night Blue
  - Light themes: Light Modern, Solarized Light, Quiet Light
  - Settings page with visual theme previews, separated by dark/light sections
  - Monaco editor theme updates automatically with app theme
  - Theme preference persists across sessions
  - Flash-free startup — correct theme applied before first paint
  - Cycle themes with `Ctrl+Alt+]` / `Ctrl+Alt+[`
  - "View Settings File" button for raw JSON access

- **HTML Preview** — Switch to "Preview" for HTML files to see rendered output in a sandboxed iframe. Supports JavaScript execution, live updates, and works with unsaved content.

### Improvements

- **Sidebar File Explorer** — Linked folders now display as a tree view instead of a flat file list
  - Expand/collapse folders to browse nested directories
  - Folder expansion state persists when switching between linked folders
  - Same file operations and search as the in-tab File Explorer panel

- **Keyboard Shortcuts** — `Ctrl+Tab`, `Ctrl+W`, `Ctrl+N`, `Ctrl+O` now work reliably regardless of which editor type is active (previously failed when focus was in preview editors like Markdown, PDF, or Image viewers)

### Other New Features

- **Quick Add Page Menu** — The "+" button in the tab bar now has a dropdown arrow for quickly creating pre-configured editor pages:
  - Script (JS) — new JavaScript file ready for scripting
  - Grid (JSON) — new `.grid.json` file with Grid editor active
  - Grid (CSV) — new `.grid.csv` file with Grid editor active
  - Notebook — new `.note.json` file with Notebook editor active
  - Todo — new `.todo.json` file with Todo editor active
  - Links — new `.link.json` file with Link editor active

---

## Version 1.0.7

### New Features

- **Markdown View Enhancements**
  - Syntax highlighting in fenced code blocks using Monaco's `colorize()` API
  - Supports all Monaco languages with alias resolution (e.g., `ts`, `js`, `py`, `bash`)
  - Copy-to-clipboard button on code block hover
  - Inline Mermaid diagram rendering for ` ```mermaid ` code blocks
  - Mermaid diagrams use dark theme with text contrast fix for readable labels
  - Shared rendering pipeline with standalone Mermaid viewer (`.mmd` files)
  - Compact mode font size increase for better readability in notebook notes

### Improvements

- Distinctive file icons for `.note.json` (notebook) and `.grid.json`/`.grid.csv` (grid) files in tabs and sidebar
- Restyled editor switch buttons with modern look and hover effects
- Notebook editor: smoother transitions, improved focus indication
- Expanded note editor now properly fills available space
- Disabled browser spellcheck in editor windows

### Bug Fixes

- Fixed notebook editor overwriting raw content when JSON has parse errors

---

## Version 1.0.6

### New Features

- **Mermaid Diagram Viewer**: Preview `.mmd` and `.mermaid` files as rendered diagrams
  - Supports all Mermaid diagram types (flowchart, sequence, class, state, ER, Gantt, pie, git graph)
  - Switch between text editor and diagram preview using toolbar button
  - Light/dark theme toggle for diagram rendering
  - Copy diagram to clipboard as image
  - Zoom, pan, and keyboard shortcuts (reuses Image Viewer controls)
  - Live preview of unsaved changes with debounced re-rendering
  - Mermaid syntax highlighting in Monaco editor

- **Copy Image to Clipboard**: Copy displayed images to clipboard as PNG
  - Copy button in Image Viewer toolbar and SVG Preview toolbar
  - Ctrl+C keyboard shortcut when image is focused
  - Works with all image formats (PNG, JPG, GIF, BMP, WebP) and SVG preview
  - Paste into external apps (Teams, Word, Outlook, etc.)

- **Notebook Editor**: A structured notes editor for `.note.json` files
  - Create and organize notes with categories and tags
  - Each note contains its own code editor (Monaco, Grid, Markdown, SVG)
  - Hierarchical category tree with drag-and-drop organization
  - Tag system with categorized tags (e.g., "env:dev", "env:prod")
  - Full-text search across note titles, categories, tags, and content
  - Search highlighting in all editor types (Monaco, Grid, Markdown)
  - Expand any note to full editor size for detailed work
  - Run JavaScript scripts directly from notes
  - Comments on individual notes
  - Virtualized list for smooth scrolling with many notes
  - See [Notebook Editor](./notebook.md) for full documentation

---

## Version 1.0.5

### New Features

- **About Page**: View application and system information
  - Access via Info button in the sidebar menu
  - Shows app version, Electron, Node.js, and Chromium versions
  - "Check for Updates" button to manually check for new versions
  - Links to GitHub repository, downloads, and issue tracker

- **Automatic Update Check**: Get notified when new versions are available
  - Checks GitHub Releases automatically on startup (once per 24 hours)
  - Shows notification when a new version is available
  - Click notification to open About page for download link
  - No automatic downloads - you stay in control

- **Image Viewer**: View binary images directly in the application
  - Supported formats: PNG, JPG, GIF, WEBP, BMP, ICO
  - Zoom with mouse wheel or +/- buttons
  - Pan by dragging when zoomed in
  - Click zoom indicator to reset to fit view
  - Automatic fit-to-window on open

- **SVG Preview**: Preview SVG files as rendered graphics
  - Open SVG in Monaco text editor by default
  - Switch to "Preview" mode using toolbar button
  - Same zoom/pan controls as Image Viewer
  - Shows live preview of unsaved changes

### Improvements

- **Application Structure Refactoring**: Major reorganization of codebase for better maintainability
  - New folder structure: `/core`, `/store`, `/editors`, `/components`, `/features`
  - All editors now in unified `/editors` folder
  - Better separation of concerns

- **Editor Registry Pattern**: New declarative system for editor registration
  - Single place to register editors (`register-editors.ts`)
  - Adding new editors now requires only one file change
  - Automatic file type detection by extension or filename patterns
  - Priority-based editor resolution
  - See [Editor Guide](/doc/standards/editor-guide.md) for details

### Documentation

- New developer documentation structure
- Architecture documentation
- Coding standards and guides
- Task tracking system
- User documentation with guides

---

## Version 1.0.4

### Improvements

- File operations improvements

---

## Version 1.0.3

### Features

- Grid improvements for JSON/CSV viewing
- Better file operation handling

---

## Version 1.0.2

### Bug Fixes

- Various stability improvements

---

## Version 1.0.1

### Features

- Initial public release
- Monaco Editor integration
- JavaScript script execution
- JSON/CSV Grid view
- Markdown preview
- PDF viewer
- Tab management
- File encryption

---

## Planned Features

See [GitHub Issues](https://github.com/andriy-viyatyk/js-notepad/issues) for planned features and known issues.

### Coming Soon

- Testing infrastructure
- Keyboard shortcut customization
