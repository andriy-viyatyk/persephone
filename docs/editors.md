[← Home](./index.md)

# Editors

js-notepad includes multiple editors for different file types. Some files support switching between editors using toolbar buttons.

## Text Editor (Default)

The default editor for all text files, powered by Monaco (the same engine as VS Code):

- **Syntax highlighting** for 50+ languages
- **IntelliSense** and auto-completion
- **Find and replace** (`Ctrl+F` / `Ctrl+H`)
- **Multi-cursor editing** (`Alt+Click`, `Ctrl+D`, `Ctrl+Alt+Up/Down`)
- **Code folding** — collapse and expand code blocks
- **Column selection** — `Shift+Alt+Arrow` keys for rectangular selection
- **Minimap** — code overview on the right side
- **Delete line** — `Ctrl+Y` deletes the entire current line

The text editor also provides a **Script Panel** for running JavaScript against any file's content. See [Scripting](./scripting.md) for details.

## Grid Editor

A spreadsheet-like interface for JSON and CSV data with sorting, filtering, cell editing, and full keyboard navigation.

**Supported formats:**
- JSON files containing an array of objects
- CSV files (auto-detects delimiter)
- Files with `.grid.json` or `.grid.csv` extensions open directly in Grid view

**Key features:**
- Click column headers to sort
- Filter rows by column values
- Copy/paste to and from Excel (`Ctrl+C` / `Ctrl+V`)
- Edit cells directly (Enter/F2 to edit, Escape to cancel)
- Insert and delete rows (`Ctrl+Insert` / `Ctrl+Delete`)
- Insert and delete columns (`Ctrl+Shift+Insert` / `Ctrl+Shift+Delete`)
- Copy with headers (`Ctrl+Shift+C`)
- Copy as JSON or HTML table
- Column management (show/hide, reorder, resize)
- Full keyboard navigation

See **[Grid Editor](./grid-editor.md)** for complete documentation including all keyboard shortcuts.

## Markdown Preview

For `.md` and `.markdown` files — click **Preview** in the toolbar:

- **GitHub-flavored Markdown** rendering
- **Text search** — press `Ctrl+F` to find text, `F3`/`Shift+F3` to navigate matches, `Esc` to close
- **Syntax highlighting** in fenced code blocks using Monaco's colorize API (supports all Monaco languages including aliases like `ts`, `js`, `py`, `bash`)
- **Copy-to-clipboard** button on code block hover
- **Inline Mermaid diagrams** — ` ```mermaid ` code blocks render as SVG diagrams
- **Live preview** updates as you type
- **Minimap** navigation on the right side

## PDF Viewer

For `.pdf` files — opens automatically:

- Page navigation (scroll or page controls)
- Zoom controls (in/out, fit to page)
- Text search within PDF
- Read-only view

## Image Viewer

For image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`) — opens automatically:

- **Zoom** with mouse wheel or toolbar +/- buttons
- **Pan** by dragging when zoomed in
- **Fit to window** (default view)
- **Reset zoom** — click the zoom percentage indicator
- **Copy to clipboard** — `Ctrl+C` or toolbar button (copies as PNG)

## SVG Preview

For `.svg` files — opens in text editor by default, click **Preview** in the toolbar:

- Same zoom/pan/copy controls as Image Viewer
- **Live preview** of unsaved changes
- Switch between text editor and preview anytime

## Mermaid Diagram Viewer

For `.mmd` and `.mermaid` files — click **Mermaid** in the toolbar:

- Supports all Mermaid diagram types (flowchart, sequence, class, state, ER, Gantt, pie, git graph)
- Same zoom/pan controls as Image Viewer
- **Light/dark theme toggle** (dark by default, light for copying into documents)
- **Copy diagram** to clipboard as image
- **Live preview** with debounced re-rendering
- Mermaid syntax highlighting in the text editor

## HTML Preview

For `.html` files — click **Preview** in the toolbar:

- **Live preview** of unsaved changes
- **JavaScript execution** — scripts in the HTML run in the preview
- **Sandboxed rendering** — preview is isolated from the application
- Switch between text editor and preview anytime

## Browser

A built-in web browser for viewing documentation, APIs, and web resources without leaving js-notepad.

**Opening:** Click the dropdown arrow (&#9662;) next to the **+** button in the tab bar → **Browser**.

**Features:**
- **URL bar** — type a URL and press Enter to navigate; type a search term to search with the selected engine; navigate button at the end of the input
- **URL suggestions** — dropdown appears when you focus or type in the URL bar
  - On focus: shows navigation history (URLs visited in the current tab)
  - On typing: shows filtered search history with highlighted matches
  - Navigate with arrow keys, select with Enter, dismiss with Escape
  - "Clear" button removes visible filtered entries from search history
- **Search engine selector** — clickable label in the URL bar on blank pages and search result pages
  - 11 engines: Google (default), Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, Gibiru
  - Switch engines on a search results page to re-search the same query on a different engine
- **Paste and Go** — right-click the URL bar for a "Paste and Go" option that pastes clipboard text and navigates immediately
- **Navigation** — Home, Back, Forward, Reload/Stop buttons in the toolbar
  - **Home button** — each tab remembers its "home" URL (first URL navigated to); tooltip shows the URL
- **Internal tabs** — multiple browser tabs within a single js-notepad tab, shown on a left-side panel
  - Clicking `target="_blank"` links opens a new internal tab; `window.open()` from JavaScript opens a real popup window (for OAuth/auth flows)
  - Close Tab button in the toolbar; new tab button at the bottom of the tabs panel
  - Right-click tab for context menu: Close Tab, Close Other Tabs, Close Tabs Below
  - Resizable tabs panel with splitter; starts collapsed to icon-only mode
  - Active tab styled with dark background and blue border
  - **Compact mode** — when the panel is narrow, hovering a tab shows a floating popup with title and close button
  - **Audio mute** — volume icon on tabs playing audio; click to mute/unmute individual tabs or all tabs at once (via the page tab icon)
  - Closing the last tab opens a fresh blank page
- **Browser Profiles** — isolated browsing sessions with separate cookies, storage, and cache
  - Create named profiles with custom colors in **Settings → Browser Profiles**
  - Open a profiled browser via &#9662; → **Browser profile...** submenu
  - Set a default profile — the **Browser** quick-add item uses it
  - Profile color is shown on the page tab icon (tinted globe)
  - Change profile color by clicking the color dot in Settings
  - Clear browsing data per profile via the "clear data" button in Settings
  - Deleting a profile shows a confirmation dialog and also clears all data from disk
- **Incognito mode** — ephemeral browsing with no persistent data
  - Open via &#9662; → **Browser profile...** → **Incognito**
  - Incognito icon on the page tab and inside the URL bar
  - All data is automatically discarded when the tab closes
  - Search history is not saved in incognito mode
- **Context menu** — right-click in the web page for contextual actions:
  - On a link: "Open Link in New Tab", "Copy Link Address"
  - On an image: "Open Image in New Tab" (opens in Image Viewer), "Copy Image Address"
  - On selected text: "Copy"
  - On an editable field: "Cut", "Copy", "Paste"
  - On an SVG element: "Open SVG in Editor" (opens in text editor with XML syntax)
  - Always available: "Back", "Forward", "Reload", "View Source", "View Actual DOM", "Inspect Element"
- **View Source** — view the raw HTML as fetched from the server
- **View Actual DOM** — view the live rendered DOM (post-JavaScript execution)
- **Page title** — shown in the js-notepad tab (reflects the active internal tab)
- **Favicon** — website icon displayed in internal tabs panel
- **Loading indicator** — animated bar below the toolbar while a page is loading
- **Find in page** — `Ctrl+F` to search text within the web page
- **Focus URL bar** — `Ctrl+L` to quickly jump to the URL bar
- **DevTools** — click the gear icon to open the webview's developer tools
- **Session restore** — all internal tabs, URLs, navigation history, and profile selection saved and restored across app restarts
- **Isolated storage** — each profile has its own cookies, storage, and cache, separated from the main application

**Security:** Navigation to local file protocols (`file://`, `app-asset://`) is blocked.

## Compare Mode

Compare two files side-by-side using Monaco's built-in diff viewer:

1. Open two text files
2. Hold `Ctrl` and click the second file's tab to group them side-by-side
3. Click the **Compare** button in the toolbar

**Features:**
- Side-by-side diff view
- Inline diff highlighting (additions, deletions, modifications)
- Navigate between changes

See [Tabs & Navigation](./tabs-and-navigation.md) for more on tab grouping.

## Todo Editor

For `.todo.json` files — a structured task list interface:

- **Multiple lists** — organize tasks into named lists (e.g., "Project A", "Personal")
- **Tags** — define colored tags and assign one tag per item for categorization (e.g., "bug", "feature")
- **Tag filtering** — click a tag in the left panel to filter items; combines with list filter and search
- **Item counts** — each list shows undone/total count badges
- **Quick add** — type and press Enter to add new items
- **Checkbox toggle** — mark items done/undone with a click
- **Sorting** — undone items first, then done items sorted by completion date
- **Drag-to-reorder** — reorder undone items via drag handle (select a specific list first)
- **Optional comments** — add multiline comments to any item
- **Dates** — hover to see created/done dates
- **Search** — toolbar search filters items with highlighted matches
- **Inline editing** — edit titles and comments for both done and undone items
- **List management** — add, rename, and delete lists
- **Tag management** — add, rename, delete tags; assign colors from a predefined palette
- Can switch to Monaco for raw JSON editing

## Notebook Editor

For `.note.json` files — a structured notes interface:

- **Categories** and **tags** for organizing notes
- Each note has its own code editor (Monaco, Grid, Markdown, SVG)
- **Full-text search** with highlighting across all content
- **Drag-and-drop** to reorganize categories
- **Expand** notes to full editor size
- **Run JavaScript** from individual notes
- Optional **comments** on each note

See **[Notebook Editor](./notebook.md)** for detailed documentation.

## Switching Editors

Some files support multiple editors:

| File Type | Available Editors |
|-----------|-------------------|
| `.json` | Text, Grid |
| `.note.json` | Text, Notebook |
| `.todo.json` | Text, ToDo |
| `.csv` | Text, Grid |
| `.md` | Text, Preview |
| `.svg` | Text, Preview |
| `.html` | Text, Preview |
| `.mmd` | Text, Mermaid |
| `.pdf` | PDF only |
| Images | Image Viewer only |
| Other | Text only |

Use the buttons in the toolbar to switch between available editors.

**Quick Add:** Click the dropdown arrow (&#9662;) next to the **+** button in the tab bar to create a new page with a specific editor: Script (JS), Grid (JSON), Grid (CSV), Notebook, Todo, Browser, or Browser profile (with Incognito and named profiles).
