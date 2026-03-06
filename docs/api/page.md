[← API Reference](./index.md)

# page

Represents the current page (tab). Available as the global `page` variable in scripts.

```javascript
// Read/write content
page.content = page.content.toUpperCase();

// Access grouped output page (auto-creates if none)
page.grouped.content = JSON.stringify(result);

// Store data across script runs
page.data.counter = (page.data.counter || 0) + 1;
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique page identifier. Read-only. |
| `type` | `string` | Page type (e.g., `"textFile"`, `"browserPage"`). Read-only. |
| `title` | `string` | Display title. Read-only. |
| `modified` | `boolean` | True if page has unsaved changes. Read-only. |
| `pinned` | `boolean` | True if tab is pinned. Read-only. |
| `filePath` | `string?` | Absolute file path, if backed by a file. Read-only. |
| `content` | `string` | Text content. **Read/write.** Only meaningful for text-based pages. |
| `language` | `string` | Language ID (e.g., `"json"`, `"typescript"`). **Read/write.** |
| `editor` | `PageEditor` | Active editor ID (e.g., `"monaco"`, `"grid-json"`). **Read/write.** |
| `data` | `Record<string, any>` | In-memory data storage. Persists across script runs but not app restarts. |
| `grouped` | `IPage` | Grouped (side-by-side) partner page. Auto-creates if none exists. |

### PageEditor values

`"monaco"` · `"grid-json"` · `"grid-csv"` · `"md-view"` · `"notebook-view"` · `"todo-view"` · `"link-view"` · `"svg-view"` · `"html-view"` · `"mermaid-view"` · `"pdf-view"` · `"image-view"` · `"browser-view"` · `"about-view"` · `"settings-view"`

## Editor Facades

Editor facades provide specialized access to a page's content through the appropriate editor. Call `page.asX()` to get a facade.

All facades are async and must be awaited:

```javascript
const grid = await page.asGrid();
grid.addRows(5);
```

> **Auto-release:** All editor facades acquired during a script run are automatically released when the script finishes. You don't need to clean up manually.

---

### asText() → `Promise<ITextEditor>`

Monaco text editor features. Only for text pages.

Methods that interact with the Monaco instance (`insertText`, `replaceSelection`, `getSelectedText`, `getCursorPosition`) require the editor to be visible — check `editorMounted` first.

| Member | Type | Description |
|--------|------|-------------|
| `editorMounted` | `boolean` | True when Monaco editor is visible and mounted. |
| `getSelectedText()` | `string` | Currently selected text, or `""`. |
| `revealLine(lineNumber)` | `void` | Scroll to reveal a line in the center. |
| `setHighlightText(text)` | `void` | Highlight all occurrences with find-match decorations. |
| `getCursorPosition()` | `{lineNumber, column}` | Current cursor position. |
| `insertText(text)` | `void` | Insert text at cursor position. |
| `replaceSelection(text)` | `void` | Replace current selection with text. |

```javascript
const text = await page.asText();
if (text.editorMounted) {
    const selected = text.getSelectedText();
    text.replaceSelection(selected.toUpperCase());
}
```

---

### asGrid() → `Promise<IGridEditor>`

Grid data manipulation. Only for text pages with JSON or CSV content.

| Member | Type | Description |
|--------|------|-------------|
| `rows` | `any[]` | All rows as plain objects. |
| `columns` | `IColumnInfo[]` | Column definitions (`key`, `name`). |
| `rowCount` | `number` | Number of rows. |
| `editCell(columnKey, rowKey, value)` | `void` | Edit a single cell value. |
| `addRows(count?, insertIndex?)` | `any[]` | Add empty rows. Returns new rows. |
| `deleteRows(rowKeys)` | `void` | Delete rows by keys. |
| `addColumns(count?, insertBeforeKey?)` | `IColumnInfo[]` | Add columns. Returns new column definitions. |
| `deleteColumns(columnKeys)` | `void` | Delete columns by keys. |
| `setSearch(text)` | `void` | Set search filter text. |
| `clearSearch()` | `void` | Clear search filter. |

```javascript
const grid = await page.asGrid();

// Add 3 rows at the end
grid.addRows(3);

// Edit a cell
grid.editCell("name", "0", "Alice");

// Read all data
grid.rows.forEach(row => console.log(row.name, row.age));
```

---

### asNotebook() → `Promise<INotebookEditor>`

Notebook editor. Only for `.note.json` pages.

| Member | Type | Description |
|--------|------|-------------|
| `notes` | `INote[]` | All notes (not filtered by UI). Each has `id`, `title`, `content`, `category`, `tags`. |
| `categories` | `string[]` | All category names. |
| `tags` | `string[]` | All tag names. |
| `notesCount` | `number` | Total number of notes. |
| `addNote()` | `INote` | Add a new note. Returns it. |
| `deleteNote(id)` | `void` | Delete a note. |
| `updateNoteTitle(id, title)` | `void` | Update title. |
| `updateNoteContent(id, content)` | `void` | Update text content. |
| `updateNoteCategory(id, category)` | `void` | Update category. |
| `addNoteTag(id, tag)` | `void` | Add a tag to a note. |
| `removeNoteTag(id, tagIndex)` | `void` | Remove a tag by index. |

```javascript
const nb = await page.asNotebook();
const note = nb.addNote();
nb.updateNoteTitle(note.id, "Meeting Notes");
nb.updateNoteContent(note.id, "Discussed project timeline...");
nb.updateNoteCategory(note.id, "Work");
```

---

### asTodo() → `Promise<ITodoEditor>`

Todo list editor. Only for `.todo.json` pages.

| Member | Type | Description |
|--------|------|-------------|
| `items` | `ITodoItem[]` | All items. Each has `id`, `title`, `completed`, `list`, `tag`. |
| `lists` | `string[]` | All list names. |
| `tags` | `ITodoTag[]` | All tag definitions (`name`, `color`). |
| `addItem(title)` | `void` | Add item to the current list. |
| `toggleItem(id)` | `void` | Toggle completion. |
| `deleteItem(id)` | `void` | Delete an item. |
| `updateItemTitle(id, title)` | `void` | Update item title. |
| `addList(name)` | `boolean` | Add a list. Returns false if name exists. |
| `renameList(oldName, newName)` | `boolean` | Rename a list. Returns false on conflict. |
| `deleteList(name)` | `void` | Delete a list and all its items. |
| `addTag(name)` | `boolean` | Add a tag. Returns false if name exists. |
| `selectList(name)` | `void` | Select a list by name. Empty string selects "All". |
| `selectTag(name)` | `void` | Select a tag filter by name. Empty string selects "All Tags". |
| `setSearch(text)` | `void` | Set search filter text. |
| `clearSearch()` | `void` | Clear search filter. |

```javascript
const todo = await page.asTodo();
todo.addList("Shopping");
todo.addItem("Buy milk");
todo.addItem("Buy bread");

// List all incomplete items
todo.items
    .filter(i => !i.completed)
    .forEach(i => console.log(i.title));
```

---

### asLink() → `Promise<ILinkEditor>`

Link collection editor. Only for `.link.json` pages.

| Member | Type | Description |
|--------|------|-------------|
| `links` | `ILink[]` | All links. Each has `id`, `url`, `title`, `category`, `tags`, `pinned`. |
| `categories` | `string[]` | All category names. |
| `tags` | `string[]` | All tag names. |
| `linksCount` | `number` | Total number of links. |
| `addLink(url, title?, category?)` | `void` | Add a link. |
| `deleteLink(id)` | `void` | Delete a link. |
| `updateLink(id, { title?, category?, url? })` | `void` | Update link properties. |

```javascript
const le = await page.asLink();
le.addLink("https://github.com", "GitHub", "Development");
le.addLink("https://stackoverflow.com", "Stack Overflow", "Development");
```

---

### asBrowser() → `Promise<IBrowserEditor>`

Browser control. Only for browser pages.

| Member | Type | Description |
|--------|------|-------------|
| `url` | `string` | Current URL. Read-only. |
| `title` | `string` | Current page title. Read-only. |
| `navigate(url)` | `void` | Navigate to a URL or search query. |
| `back()` | `void` | Go back in history. |
| `forward()` | `void` | Go forward in history. |
| `reload()` | `void` | Reload (or stop loading). |

```javascript
const browser = await page.asBrowser();
browser.navigate("https://example.com");
console.log(browser.url);    // "https://example.com"
console.log(browser.title);  // "Example Domain"
```

---

### asMarkdown() → `Promise<IMarkdownEditor>`

Markdown preview. Only for text pages with markdown content.

| Member | Type | Description |
|--------|------|-------------|
| `viewMounted` | `boolean` | True if the preview is mounted in the DOM. |
| `html` | `string` | Rendered HTML content. Empty if view is not mounted. |

```javascript
const md = await page.asMarkdown();
if (md.viewMounted) {
    console.log(md.html); // the rendered HTML
}
```

---

### asSvg() → `Promise<ISvgEditor>`

SVG preview. Only for text pages with SVG content.

| Member | Type | Description |
|--------|------|-------------|
| `svg` | `string` | The SVG source content. |

---

### asHtml() → `Promise<IHtmlEditor>`

HTML preview. Only for text pages with HTML content.

| Member | Type | Description |
|--------|------|-------------|
| `html` | `string` | The HTML source content. |

---

### asMermaid() → `Promise<IMermaidEditor>`

Mermaid diagram preview. Only for text pages with mermaid content.

| Member | Type | Description |
|--------|------|-------------|
| `svgUrl` | `string` | Data URL of the rendered SVG. Empty while loading or on error. |
| `loading` | `boolean` | True while rendering. |
| `error` | `string` | Error message if rendering failed. Empty on success. |

```javascript
const mermaid = await page.asMermaid();
if (!mermaid.loading && !mermaid.error) {
    console.log(mermaid.svgUrl); // data URL of the rendered diagram
}
```
