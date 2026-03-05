[← API Reference](./index.md)

# app.editors

Read-only registry of all editors in the application. Query available editors and resolve the best editor for a file.

```javascript
const all = app.editors.getAll();
const best = app.editors.resolve("data.json");
console.log(best?.name); // "JSON Grid"
```

## Methods

### getAll() → `IEditorInfo[]`

Get all registered editors.

```javascript
app.editors.getAll().forEach(e =>
    console.log(`${e.id}: ${e.name} (${e.category})`)
);
```

### getById(id) → `IEditorInfo | undefined`

Get editor info by ID.

```javascript
const info = app.editors.getById("grid-json");
console.log(info?.name); // "JSON Grid"
```

### resolve(filePath) → `IEditorInfo | undefined`

Resolve the best matching editor for a file path.

```javascript
const editor = app.editors.resolve("readme.md");
console.log(editor?.id); // "md-view"
```

### resolveId(filePath) → `string | undefined`

Resolve just the editor ID for a file path.

### getSwitchOptions(languageId, filePath?) → `ISwitchOptions`

Get available editor switch options for a language. Used to build editor switch dropdowns.

```javascript
const opts = app.editors.getSwitchOptions("json", "data.json");
opts.options.forEach(id =>
    console.log(`${id}: ${opts.getOptionLabel(id)}`)
);
```

## IEditorInfo

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Editor ID (e.g., `"monaco"`, `"grid-json"`). |
| `name` | `string` | Display name (e.g., `"Text Editor"`, `"JSON Grid"`). |
| `category` | `EditorCategory` | `"page-editor"` or `"content-view"`. |

### Editor Categories

- **`content-view`** — Views of text content. Can switch between each other (e.g., JSON text ↔ Grid). Examples: Monaco, Grid, Markdown, Notebook, Todo, Link, SVG, HTML, Mermaid.
- **`page-editor`** — Standalone editors with their own page model. Examples: PDF viewer, Image viewer, Browser, About, Settings, Compare.
