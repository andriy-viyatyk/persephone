# IEditorRegistry — `app.editors`

**Status:** Implemented (Phase 1)

Read-only registry of all editors in the application. Query available editors, resolve the best editor for a file, and get switch options for the UI.

## Access

```javascript
app.editors
```

## Methods

### `getAll()`

Get all registered editors.

```javascript
const editors = app.editors.getAll();
editors.forEach(e => console.log(`${e.id}: ${e.name} (${e.category})`));
```

**Returns:** `IEditorInfo[]`

---

### `getById(id)`

Get editor info by ID.

```javascript
const editor = app.editors.getById("monaco");
// { id: "monaco", name: "Text Editor", category: "content-view" }
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `string` | Editor ID (e.g. `"monaco"`, `"grid-json"`, `"pdf-view"`) |

**Returns:** `IEditorInfo | undefined`

---

### `resolve(filePath)`

Resolve the best matching editor for a file path. Each editor declares which files it accepts and with what priority. The highest-priority match wins.

```javascript
const editor = app.editors.resolve("data.json");
// { id: "monaco", name: "Text Editor", category: "content-view" }

const pdfEditor = app.editors.resolve("report.pdf");
// { id: "pdf-view", name: "PDF Viewer", category: "page-editor" }
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | File path or name to resolve |

**Returns:** `IEditorInfo | undefined` — `undefined` if no editor matches.

---

### `resolveId(filePath)`

Convenience method that returns just the editor ID instead of the full info object.

```javascript
const editorId = app.editors.resolveId("image.png");
// "image-view"
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | File path or name to resolve |

**Returns:** `string | undefined`

---

### `getSwitchOptions(languageId, filePath?)`

Get available editor switch options for a language. Used to build "Switch Editor" dropdowns — e.g., for JSON you can switch between Text Editor and JSON Grid.

```javascript
const { options, getOptionLabel } = app.editors.getSwitchOptions("json");
options.forEach(id => console.log(getOptionLabel(id)));
// "JSON"
// "JSON Grid"
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `languageId` | `string` | Monaco language ID (e.g. `"json"`, `"markdown"`, `"csv"`) |
| `filePath` | `string?` | Optional file path for context-sensitive options |

**Returns:** `ISwitchOptions`
| Property | Type | Description |
|----------|------|-------------|
| `options` | `string[]` | Available editor IDs, sorted by priority. Empty if only one editor applies. |
| `getOptionLabel` | `(option: string) => string` | Get the display label for an editor option. |

---

## Types

### `IEditorInfo`

Read-only information about a registered editor.

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique editor ID (e.g. `"monaco"`, `"grid-json"`, `"pdf-view"`) |
| `name` | `string` | Human-readable name (e.g. `"Text Editor"`, `"JSON Grid"`) |
| `category` | `EditorCategory` | `"page-editor"` or `"content-view"` |

### `EditorCategory`

- `"page-editor"` — Standalone editors with their own page model (e.g., PDF viewer, Image viewer). Render instead of the text editor and handle their own UI entirely.
- `"content-view"` — Views of text-based content (e.g., Monaco, Grid, Markdown preview). Can switch between each other.

---

## Examples

### List all editors

```javascript
app.editors.getAll().forEach(e => {
    console.log(`${e.name} [${e.category}]`);
});
```

### Check which editor opens a file

```javascript
const editor = app.editors.resolve("data.csv");
if (editor) {
    console.log(`${editor.name} handles CSV files`);
}
```

### Get available views for JSON

```javascript
const { options, getOptionLabel } = app.editors.getSwitchOptions("json");
if (options.length > 1) {
    console.log("Available views:", options.map(getOptionLabel).join(", "));
}
```

---

## Implementation Notes

- The registry is populated at startup by `register-editors.ts` — editors cannot be added at runtime
- `register()`, `loadModule()`, `acceptFile()`, and other internal methods are not exposed
- `validateForLanguage()` and `getPreviewEditor()` are internal methods used by editor components
- The wrapper maps `EditorDefinition` to `IEditorInfo`, stripping internal fields
