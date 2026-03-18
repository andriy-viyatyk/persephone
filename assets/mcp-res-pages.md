# Pages & Windows

js-notepad uses tabbed pages (like browser tabs). Each page has a type and editor.

## Multi-Window Support

js-notepad supports multiple windows. Each window has a stable `windowIndex` (starting from 0) and its own set of pages.

### Discovering Windows

Use `list_windows` to see all windows and their status:

```json
[
  { "windowIndex": 0, "status": "open", "pageCount": 3, "activePageId": "abc", "pages": [...] },
  { "windowIndex": 1, "status": "closed", "pageCount": 2, "activePageId": "def", "pages": [...] }
]
```

- **open** — window is visible and running
- **closed** — window was closed but its pages are persisted (e.g. had unsaved changes)

### Targeting a Window

All tools accept an optional `windowIndex` parameter:

```
execute_script({ script: "page.content", windowIndex: 1 })
list_pages({ windowIndex: 0 })
create_page({ title: "Notes", windowIndex: 1 })
```

If `windowIndex` is omitted, the first open window is used (backward compatible).

### Reopening Closed Windows

Closed windows cannot be targeted directly by other tools. Use `open_window` to reopen them first:

```
open_window({ windowIndex: 1 })  // Reopens window 1 with its persisted pages
```

After reopening, you can target the window with any tool using `windowIndex`.

## The `page` Object

The current page (tab). Available as a global in scripts.

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique page identifier (read-only) |
| `title` | `string` | Display title (read-only) |
| `content` | `string` | Text content (**read/write**) |
| `language` | `string` | Language ID, e.g. `"json"`, `"typescript"` (**read/write**) |
| `editor` | `string` | Editor type, e.g. `"monaco"`, `"grid-json"` (**read/write**) |
| `filePath` | `string?` | File path if backed by a file (read-only) |
| `modified` | `boolean` | Has unsaved changes (read-only) |
| `type` | `string` | Page type, e.g. `"textFile"`, `"browserPage"` (read-only) |
| `data` | `object` | In-memory storage, persists across script runs |
| `grouped` | `IPage` | Grouped (side-by-side) partner page — auto-creates if none exists |

### Editor Types

`"monaco"` · `"grid-json"` · `"grid-csv"` · `"md-view"` · `"notebook-view"` · `"todo-view"` · `"link-view"` · `"graph-view"` · `"draw-view"` · `"svg-view"` · `"html-view"` · `"mermaid-view"` · `"pdf-view"` · `"image-view"` · `"browser-view"` · `"about-view"` · `"settings-view"`

### Creating Pages with Specialized Editors

**CRITICAL: Each non-monaco editor REQUIRES a specific `language` parameter. Using the wrong language (e.g., `language: "plaintext"` with `editor: "md-view"`) will result in broken rendering — the page will appear empty or display raw text instead of rendered content.**

| Editor | Required `language` | Recommended title suffix | Example |
|--------|-------------------|------------------------|---------|
| `monaco` (default) | any (`plaintext`, `javascript`, `json`, etc.) | — | `"script.js"` |
| `md-view` | **`markdown`** | — | `"README.md"` |
| `grid-json` | **`json`** | `.grid.json` (optional) | `"Data.grid.json"` or `"Data"` |
| `grid-csv` | **`csv`** | — | `"Data"` |
| `notebook-view` | **`json`** | `.note.json` | `"My Notes.note.json"` |
| `todo-view` | **`json`** | `.todo.json` | `"Tasks.todo.json"` |
| `link-view` | **`json`** | `.link.json` | `"Bookmarks.link.json"` |
| `svg-view` | **`xml`** | `.svg` | `"Logo.svg"` |
| `html-view` | **`html`** | — | `"Page.html"` |
| `graph-view` | **`json`** | `.fg.json` | `"Network.fg.json"` |
| `draw-view` | **`json`** | `.excalidraw` | `"Sketch.excalidraw"` |
| `mermaid-view` | **`mermaid`** | — | `"Diagram"` |

**Common mistake:** `create_page({ editor: "md-view", language: "plaintext", ... })` — this creates a broken page. Use `language: "markdown"` with `md-view`.

**Title suffix:** Without the correct title suffix, the editor will work but the toolbar switch buttons may not show all available editor options (e.g., a link editor page titled `"Links"` won't show the "Links" switch button, but `"Links.link.json"` will).

**Initial content:** Notebook, todo, link, and graph editors expect valid JSON content on creation:
- **Notebook:** `{"notes":[],"state":{}}`
- **Todo:** `{"lists":[],"tags":[],"items":[],"state":{}}`
- **Links:** `{"links":[],"state":{}}`
- **Graph:** `{"nodes":[],"links":[],"options":{}}` — see Graph Format below

### Graph Editor Format (`graph-view`)

The graph editor renders an interactive force-directed graph. Content is JSON with this structure:

```json
{
  "type": "force-graph",
  "nodes": [
    { "id": "server", "title": "API Server", "level": 1, "shape": "hexagon" },
    { "id": "db", "title": "Database", "level": 2, "shape": "square" },
    { "id": "cache", "title": "Redis Cache", "level": 3 },
    { "id": "client", "title": "Web Client", "level": 2, "shape": "diamond", "team": "frontend" }
  ],
  "links": [
    { "source": "client", "target": "server" },
    { "source": "server", "target": "db" },
    { "source": "server", "target": "cache" }
  ],
  "options": {
    "rootNode": "server",
    "expandDepth": 3,
    "maxVisible": 500
  }
}
```

**Node properties:**

| Property | Type | Description |
|----------|------|-------------|
| `id` | string (required) | Unique node identifier, used in links |
| `title` | string | Display label (falls back to `id` if omitted) |
| `level` | number (1-5) | Hierarchy level — controls node size (1=largest, 5=smallest) |
| `shape` | string | `"circle"` (default), `"square"`, `"diamond"`, `"triangle"`, `"star"`, `"hexagon"` |
| *custom* | any | Any additional properties are preserved and displayed in the detail panel |

**Link properties:**

| Property | Type | Description |
|----------|------|-------------|
| `source` | string (required) | Source node `id` |
| `target` | string (required) | Target node `id` |

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `rootNode` | string | Root node ID — BFS expansion starts here |
| `expandDepth` | number | How many hops from root to show initially (default: show all) |
| `maxVisible` | number | Hard ceiling on visible nodes (default 500) — use for large graphs |
| `charge` | number | Repulsion force between nodes (default -70) |
| `linkDistance` | number | Desired link length in pixels (default 40) |
| `collide` | number | Collision radius multiplier (default 0.7) |

**Tips for generating graphs:**
- Always include `"type": "force-graph"` for content detection
- Use `level` to visually distinguish node importance (1=central/important, 5=leaf/minor)
- Use `shape` to encode node categories (e.g., hexagons for services, squares for databases)
- Add custom properties for metadata (e.g., `"team"`, `"status"`, `"url"`) — they appear in the detail panel
- For large graphs (>200 nodes), set `rootNode` and `expandDepth` to avoid overwhelming the view
- Title suffix `.fg.json` ensures the graph editor opens by default and shows the JSON/Graph switch

## Grouped Pages (Script Output)

When a script runs, the **return value** is written to a grouped (side-by-side) output page. You can configure the output page:

```javascript
// Return value becomes the output content
const data = JSON.parse(page.content);
page.grouped.language = "json";
page.grouped.editor = "grid-json";
return data.filter(item => item.active);
```

Access `page.grouped` to auto-create a grouped page. Set `page.grouped.language` and `page.grouped.editor` before returning.
