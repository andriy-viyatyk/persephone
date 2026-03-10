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

`"monaco"` · `"grid-json"` · `"grid-csv"` · `"md-view"` · `"notebook-view"` · `"todo-view"` · `"link-view"` · `"svg-view"` · `"html-view"` · `"mermaid-view"` · `"pdf-view"` · `"image-view"` · `"browser-view"` · `"about-view"` · `"settings-view"`

### Creating Pages with Specialized Editors

Some editors require specific `language` and `title` (ending with a file extension) to render correctly with proper toolbar switch buttons:

| Editor | Language | Title must end with | Example |
|--------|----------|-------------------|---------|
| `notebook-view` | `json` | `.note.json` | `"My Notes.note.json"` |
| `todo-view` | `json` | `.todo.json` | `"Tasks.todo.json"` |
| `link-view` | `json` | `.link.json` | `"Bookmarks.link.json"` |
| `grid-json` | `json` | `.grid.json` (optional) | `"Data.grid.json"` or `"Data"` |
| `grid-csv` | `csv` | — | `"Data"` |
| `md-view` | `markdown` | — | `"README.md"` |
| `svg-view` | `xml` | `.svg` | `"Logo.svg"` |
| `html-view` | `html` | — | `"Page.html"` |
| `mermaid-view` | `mermaid` | — | `"Diagram"` |

**Important:** Without the correct title suffix, the editor will work but the toolbar switch buttons may not show all available editor options (e.g., a link editor page titled `"Links"` won't show the "Links" switch button, but `"Links.link.json"` will).

**Initial content:** Notebook, todo, and link editors expect valid JSON content on creation:
- **Notebook:** `{"notes":[],"state":{}}`
- **Todo:** `{"lists":[],"tags":[],"items":[],"state":{}}`
- **Links:** `{"links":[],"state":{}}`

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
