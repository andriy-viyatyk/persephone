# ISettings — `app.settings`

Application configuration. Read and write settings with typed access and change notifications.

## Access

```javascript
app.settings
```

## Properties

### `theme` (read-only)

Current theme name.

```javascript
const currentTheme = app.settings.theme;
// "default-dark" | "solarized-dark" | "monokai" | "abyss" | "red" |
// "tomorrow-night-blue" | "light-modern" | "solarized-light" | "quiet-light"
```

**Type:** `string`

---

## Methods

### `get(key)`

Get a setting value by key.

```javascript
const theme = app.settings.get("theme");
const extensions = app.settings.get("search-extensions");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `key` | `string` | Setting key |

**Returns:** `T` — The setting value. Type depends on the key.

**Known keys:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `"theme"` | `string` | `"default-dark"` | Color theme |
| `"tab-recent-languages"` | `string[]` | `[]` | Recently used languages in picker |
| `"search-extensions"` | `string[]` | `[".ts", ".js", ...]` | File extensions for content search |
| `"search-max-file-size"` | `number` | `1048576` | Max file size (bytes) for search indexing |
| `"browser-profiles"` | `BrowserProfile[]` | `[]` | Browser profile configurations |
| `"browser-default-profile"` | `string` | `""` | Default browser profile name |
| `"browser-default-bookmarks-file"` | `string` | `""` | Bookmarks file for default profile |
| `"browser-incognito-bookmarks-file"` | `string` | `""` | Bookmarks file for incognito |
| `"link-open-behavior"` | `string` | `"default-browser"` | `"default-browser"` or `"internal-browser"` |

**Error behavior:** Returns `undefined` for unknown keys.

---

### `set(key, value)`

Update a setting value. Persisted automatically.

```javascript
app.settings.set("theme", "monokai");
app.settings.set("search-max-file-size", 2097152); // 2 MB
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `key` | `string` | Setting key |
| `value` | `T` | New value (must match expected type for key) |

**Returns:** `void`

**Side effects:**
- Setting is persisted to `appSettings.json` (debounced)
- Some settings trigger immediate effects (e.g., `"theme"` applies the theme instantly)
- `onChanged` event fires

**Error behavior:** No validation — any value is accepted. Invalid values may cause unexpected behavior.

---

## Events

### `onChanged`

Fires when any setting changes.

```javascript
app.settings.onChanged.subscribe(({ key, value }) => {
  console.log(`Setting ${key} changed to`, value);
});
```

**Event data:** `{ key: string, value: any }`

---

## Examples

### Read current theme

```javascript
const theme = app.settings.theme;
// or
const theme = app.settings.get("theme");
```

### Switch theme

```javascript
app.settings.set("theme", "solarized-dark");
```

### Check link behavior

```javascript
const behavior = app.settings.get("link-open-behavior");
if (behavior === "internal-browser") {
  // Links open in built-in browser
}
```

### React to setting changes

```javascript
app.settings.onChanged.subscribe(({ key }) => {
  if (key === "theme") {
    console.log("Theme changed!");
  }
});
```
