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

A spreadsheet-like interface for JSON, CSV, and JSONL data with sorting, filtering, cell editing, and full keyboard navigation.

**Supported formats:**
- JSON files containing an array of objects
- CSV files (auto-detects delimiter)
- JSONL / NDJSON files (one JSON object per line)
- Files with `.grid.json`, `.grid.csv`, or `.grid.jsonl` extensions open directly in Grid view

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

## Graph View

For `.fg.json` files — a force-directed graph viewer. Also activates for any JSON file that contains `"type": "force-graph"` and a `"nodes"` property. Click **Graph** in the toolbar to switch between the text editor and the graph view.

**Interaction:**
- **Zoom** — scroll wheel to zoom in/out (double-click zoom is disabled)
- **Pan** — drag the canvas background
- **Drag nodes** — click and drag individual nodes to reposition them
- **Select** — click a node to select it; selected node and its direct neighbors are highlighted. `Ctrl+Click` to toggle nodes in and out of a multi-selection.
- **Double-click node** — expands the detail panel for the clicked node
- **Hover** — hover over a node to highlight it and its children; after ~500 ms a tooltip appears showing the node's title, id, and any custom user-defined properties. Tooltips do not appear during node drag.
- **Labels** — node labels appear for selected and hovered nodes when zoomed in sufficiently. Level 1 and 2 nodes always show their label regardless of selection or zoom state. Highlighted node labels are always visible regardless of zoom level. Font size scales by level (larger for root/level 1, smaller for deeper levels). Labels display the node's `title` if present, otherwise its `id`.
- **Selection highlight** — selected node label text turns orange. Hovered node and its children get green label text.

**Node properties:**
- `id` — unique identifier (required)
- `title` — display label shown instead of `id` when present
- `level` — size tier from `1` (largest) to `5` (smallest); defaults to `5` if omitted
- `shape` — visual shape: `circle` (default), `square`, `diamond`, `triangle`, `star`, or `hexagon`
- `isGroup` — when `true`, the node is rendered as a double circle (filled inner circle with a dark blue outer ring) in violet. Group nodes use level-1 size, always-visible labels, and show a "GROUP" badge followed by "Group · N members" in tooltips (membership = links between the group and non-group nodes, in either direction). Group nodes appear in the Legend panel but are excluded from the detail edit panel and from legend level/shape counting. When groups exist, links are automatically pre-processed: membership links (group-to-member) are hidden, cross-group links are routed through the group node, inter-group links are routed through both group nodes, and intra-group links are preserved.

**Graph options:**
- `options.rootNode` — initial root node ID; the graph centers on this node. The root node is visually distinct: it uses a compass (4-pointed star) shape, level-1 size, violet color, an always-visible label, and a "ROOT NODE" badge in its tooltip.
- `options.expandDepth` — BFS depth limit from the root node; only nodes within this depth are shown initially
- `options.maxVisible` — maximum number of visible nodes (default `500`); when a graph exceeds this limit, only the closest nodes are shown initially
- `options.charge` — repulsion strength between nodes (persisted)
- `options.linkDistance` — target link distance between connected nodes (persisted)
- `options.collide` — overlap prevention strength (persisted)
- `options.legend` — legend descriptions for levels and shapes (persisted by the Legend Panel)

**Detail Panel:**

A collapsible overlay panel in the top-right corner for editing the selected node's properties. The header always shows the selected node's title (or "select node for edit" when nothing is selected). When multiple nodes are selected, the header shows "N nodes selected". Click the header or double-click a node to expand the panel. The panel auto-collapses when you deselect all nodes. Clicking the canvas background collapses expanded panels without changing the selection.

- **Info tab** — editable fields for ID (with rename validation), Title, Level (1–5 icon selector), and Shape (6 shape icons: circle, square, diamond, triangle, star, hexagon). In multi-selection mode, only Level and Shape are shown; mixed values across selected nodes are highlighted in yellow.
- Changes immediately update the canvas and JSON
- Resizable via the bottom-left corner drag handle
- **Properties tab** — an AVGrid showing all custom (non-core) key-value properties of the selected node. Supports inline editing (double-click), adding and deleting rows (`Ctrl+Insert` / `Ctrl+Delete` or context menu), copy/paste from spreadsheets, and the same Apply/Cancel batch workflow as the Links tab. Reserved keys (`id`, `title`, `level`, `shape`, and system keys) are highlighted and blocked from being added. Unsaved edits block tab switching, panel collapse, and node selection changes. In multi-selection mode, the grid shows the union of all selected nodes' properties; values that differ across nodes are highlighted in yellow, with a status message indicating mixed values.
- **Links tab** — an AVGrid showing all nodes linked to the selected node with columns for ID, Title, Level, Shape, and any custom properties. Hidden during multi-selection. Column widths are auto-detected and the ID column is sticky. Supports batch editing with Apply/Cancel buttons, adding new linked nodes (including paste from Excel), and deleting rows (removes the link, and also removes the node if it becomes orphaned). Unsaved edits block panel collapse and node selection changes. When the Links tab is active, non-linked nodes are dimmed on the canvas. Focusing a grid row highlights the corresponding node in green on the canvas and draws a green link line from the selected node to the hovered node. Hidden children are automatically expanded when the Links tab is activated.

**Editing:**
- **Add Node** — right-click on empty canvas area and choose "Add Node" to create a new node at the click position
- **Add Child** — right-click on a node and choose "Add Child" to create a new node linked to the clicked node
- **Delete Node** — right-click on a node and choose "Delete Node" to remove it and all its links. Right-clicking a node that is part of a multi-selection preserves the selection.
- **Delete Link** — right-click on a node and use the "Delete Link" submenu to remove a specific link from that node
- **Set as Root** — right-click on a node and choose "Set as Root" to designate it as the root node
- **Collapse** — right-click on a node and choose "Collapse" to hide its descendant nodes (those discovered later in BFS order from the root). Only available when visibility filtering is active.
- **Toggle Link** — `Alt+Click` on a node to add or remove a link between it and the currently selected node
- **Group Selected** — multi-select 2 or more regular (non-group) nodes, then right-click → "Group Selected" to create a new group containing them. You will be prompted to enter a title for the group. If the selection includes exactly one existing group plus regular nodes, the regular nodes are added to that group instead of creating a new one. Each node can belong to only one group — moving a node to a new group silently removes it from the old one.
- **Ungroup** — right-click a group node → "Ungroup" to dissolve the group. Member nodes are preserved; only the group node and its membership links are removed.
- **Delete Group** — right-click a group node → "Delete Group" to remove the group AND all of its member nodes.
- **Edit Title** — right-click a group node → "Edit Title" to rename the group.
- **Alt+Click membership** — select a group node, then `Alt+Click` a regular node to toggle its membership: if the node is not a member, it is added; if it is already a member, it is removed.
- **Remove from Group** — right-click a node that belongs to a group → "Remove from Group" to take it out of the group while keeping the node itself.
- All edits serialize back to clean JSON with no internal properties. Existing node positions are preserved after edits.

**Large graph support:** Graphs with more nodes than `maxVisible` automatically show a subset of nodes closest to the root node (or the most-connected node if no root is set). Nodes with hidden neighbors display a **"+"** badge — click the badge to expand and reveal the next layer of neighbors. `Ctrl+Click` on a badge performs a **deep expand**, revealing the entire hidden subtree connected to that node (already-visible nodes act as barriers). Use the **Expand All** toolbar button to make all nodes visible at once (a confirmation dialog appears when the graph has more than 1,000 nodes). Use the **Reset View** toolbar button to restore the initial visibility state. Disconnected components (nodes not reachable from the focus) show their root plus one level of children.

**Status bar:** The footer displays the node count — "N of M nodes" when visibility filtering hides some nodes, or "N nodes" when all nodes are visible.

**Empty graph:** New empty graph pages show a centered hint: "Right-click → Add Node".

**Toolbar:** The toolbar displays a search input, an expand-all icon, a reset view icon, and a gear icon in a single row. Below the toolbar, three tabs — **Physics**, **Expansion**, and **Results (N)** — switch between the force tuning panel, expansion settings panel, and search results panel. The toolbar is semi-transparent when idle and becomes fully opaque on hover, focus, or when a panel is expanded.

**Search:** The toolbar includes a search input that supports **multi-word AND matching**. Type multiple words separated by spaces — all words must match somewhere in a node's title, ID, or custom property names/values. Non-matching nodes and their links are dimmed.

When matches are found, the **Results** tab shows the match count and opens a scrollable results panel listing matching nodes with highlighted matches. Hidden nodes appear at reduced opacity and can be clicked to reveal them. Use **ArrowUp/Down** to navigate results, **Enter** to select, and **Escape** to close the results panel.

A status bar below the results shows "matched N visible" and, when hidden nodes also match, a clickable **"+K hidden"** link for bulk reveal. The status bar also provides **[select all]** and **[add to selection]** actions to select matching nodes in bulk. The collapsed search toolbar remains visible with a green border when a search is active. Press Escape or the **×** button to clear the search.

**Force Tuning:** Click the gear icon in the toolbar (or select the **Physics** tab) to toggle an expandable tuning panel with three sliders that control the force simulation in real time:
- **Charge** (-200 to 0) — how strongly nodes repel each other
- **Distance** (10 to 200) — target link distance between connected nodes
- **Collide** (0 to 1) — overlap prevention strength

Adjustments take effect immediately. Click **Reset** to restore the default values. Physics settings are persisted to the JSON `options` object and restored when the file is reopened. Clicking the canvas auto-collapses the tuning panel.

**Expansion Settings:** Select the **Expansion** tab to configure how the graph expands from the root node:
- **Root Node** — dropdown to select which node is the root (the graph centers on this node)
- **Expand Depth** — BFS depth limit from the root node
- **Max Visible** — maximum number of visible nodes

Changes to Expand Depth and Max Visible are deferred — they take effect when the file is reopened.

**Legend Panel:** A collapsible panel at the bottom-left corner for documenting what node levels and shapes mean. Click to expand (the chevron turns green when expanded); the panel has three tabs — **Level**, **Shape**, and **Selection**. The Level and Shape tabs list levels or shapes present in the graph, with a checkbox to highlight matching nodes and a text input for a free-form description. Descriptions are persisted to the JSON `options.legend` object. The root node (if set) appears in both tabs with a shared description. The **Selection** tab provides radio filters for selected/not-selected nodes, enabling quick visual isolation of multi-selected subsets. When checkboxes or radio filters are active, matching nodes are highlighted and non-matching nodes are dimmed. Collapsing the panel clears the highlighting but preserves checkbox state.

**Theme support:** Graph colors (node fill, edge color, selected/hover highlights) adapt to whichever of the 9 app themes is active.

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
| `.jsonl` / `.ndjson` | Text, Grid |
| `.md` | Text, Preview |
| `.svg` | Text, Preview |
| `.html` | Text, Preview |
| `.mmd` | Text, Mermaid |
| `.fg.json` | Text, Graph |
| `.pdf` | PDF only |
| Images | Image Viewer only |
| Other | Text only |

Use the buttons in the toolbar to switch between available editors.

**Content-based detection:** JSON pages that contain a `"type"` property (`"note-editor"`, `"todo-editor"`, `"link-editor"`, or `"force-graph"`) automatically show the corresponding switch button — even without the special file extension. For the Graph View, the JSON must also contain a `"nodes"` property. This is useful for pages created via MCP or scripting.

**Quick Add:** Click the dropdown arrow (&#9662;) next to the **+** button in the tab bar to create a new page with a specific editor: Script (JS), Script (TS), Grid (JSON), Grid (CSV), Notebook, Todo, Links, Force Graph, Browser, or Browser profile (with Incognito and named profiles).
