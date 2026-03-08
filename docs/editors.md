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

The text editor also provides a **Script Panel** for running JavaScript or TypeScript against any file's content. See [Scripting](./scripting.md) for details.

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
- **Inline Mermaid diagrams** — ` ```mermaid ` code blocks render as SVG diagrams with hover toolbar (copy image to clipboard, open in Mermaid editor)
- **Live preview** updates as you type
- **Minimap** navigation on the right side
- **Link context menu** — right-click a link for: "Copy Link", "Open in Default Browser", "Open in Internal Browser", browser profiles, "Open in Incognito"

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
- **Save Image to File** — for URL-based images, a toolbar button downloads the image and saves it to disk

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

**Key features:**
- **URL bar** with search, suggestions, and 11 search engines
- **Internal tabs** — multiple browser tabs within a single js-notepad tab
- **Browser Profiles** — isolated sessions with separate cookies, storage, and cache
- **Incognito mode** — ephemeral browsing with no persistent data
- **Bookmarks** — per-profile bookmark management with star button and bookmarks panel
- **Downloads** — toolbar button with progress tracking, download history popup
- **Context menu** — contextual actions for links, images, text, SVG elements, and developer tools
- **Default browser registration** — set js-notepad as your Windows default browser
- **Session restore** — all tabs, URLs, history, and profile selection saved across restarts
- **Find in page** — `Ctrl+F` opens inline search bar with match counter and navigation
- **Keyboard shortcuts** — `Ctrl+L` URL bar, `Ctrl+F` find, `F5` reload, `F12` DevTools, `Alt+Left/Right` back/forward, and more

See **[Browser](./browser.md)** for complete documentation including profiles, bookmarks, downloads, and all keyboard shortcuts.

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
- **Session state persistence** — selected list and tag are remembered across app restarts
- Can switch to Monaco for raw JSON editing

## Notebook Editor

For `.note.json` files — a structured notes interface:

- **Categories** and **tags** for organizing notes
- Each note has its own code editor (Monaco, Grid, Markdown, SVG)
- **Full-text search** with highlighting across all content
- **Drag-and-drop** to reorganize categories
- **Expand** notes to full editor size
- **Run JavaScript or TypeScript** from individual notes
- Optional **comments** on each note

See **[Notebook Editor](./notebook.md)** for detailed documentation.

## Link Editor

For `.link.json` files — a structured link manager:

- **Categories**, **tags**, and **hostnames** for organizing and filtering links
- **Hostnames panel** — collapsible sidebar panel showing hostnames extracted from all links, with link counts; click to filter
- **Multiple view modes** — List, Landscape tiles, Portrait tiles (normal and large variants)
- **View mode per category, per tag, and per hostname** — each filter remembers its preferred layout
- **Image tiles** — tile views display preview images with "no image" placeholder for links without images
- **Edit/Create dialog** — title (auto-growing), URL, category (with autocomplete), tags (chip-based with autocomplete), image URL with preview
- **Search** — toolbar search filters links by title or URL
- **Browser selector button** — toolbar button to choose where links open: OS default browser, internal browser, a specific browser profile, or incognito. Initialized from the app setting, adjustable per session.
- **Context menu** — Edit, Open in Default Browser, Open in Internal Browser, browser profiles, Open in Incognito, Copy URL, Pin/Unpin, Delete
  - For links with images: Copy Image URL, Open Image in New Tab (opens in Image Viewer)
- **Delete confirmation** — with Ctrl+click bypass for quick delete
- **Double-click** to edit in both list and tile views
- **Favicons** — cached favicons from the internal browser are displayed next to links in list view and as fallback in tile view
- **Drag-and-drop** — drag links onto categories to reassign them; drag categories onto other categories to reparent (with confirmation)
- **Pinned links panel** — pin important links for quick access; pinned panel appears on the right edge, auto-hides when empty, resizable, with drag-to-reorder support
- **Session state persistence** — selected category, tag, hostname, and expanded panel are remembered across app restarts
- Can switch to Monaco for raw JSON editing

## Switching Editors

Some files support multiple editors:

| File Type | Available Editors |
|-----------|-------------------|
| `.json` | Text, Grid |
| `.note.json` | Text, Notebook |
| `.todo.json` | Text, ToDo |
| `.link.json` | Text, Links |
| `.csv` | Text, Grid |
| `.md` | Text, Preview |
| `.svg` | Text, Preview |
| `.html` | Text, Preview |
| `.mmd` | Text, Mermaid |
| `.pdf` | PDF only |
| Images | Image Viewer only |
| Other | Text only |

Use the buttons in the toolbar to switch between available editors.

**Content-based detection:** JSON pages that contain a `"type"` property (`"note-editor"`, `"todo-editor"`, or `"link-editor"`) automatically show the corresponding switch button — even without the special file extension. This is useful for pages created via MCP or scripting.

**Quick Add:** Click the dropdown arrow (&#9662;) next to the **+** button in the tab bar to create a new page with a specific editor: Script (JS), Script (TS), Grid (JSON), Grid (CSV), Notebook, Todo, Links, Browser, or Browser profile (with Incognito and named profiles).
