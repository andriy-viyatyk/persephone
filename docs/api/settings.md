[← API Reference](./index.md)

# app.settings

Application configuration. Read and write settings with change notifications.

```javascript
const theme = app.settings.theme;
app.settings.set("theme", "monokai");
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `theme` | `string` | Current theme name. Read-only (use `set("theme", ...)` to change). |
| `onChanged` | `IEvent<{ key, value }>` | Fires when any setting changes. |

## Methods

### get(key) → `T`

Get a setting value by key. Returns `undefined` for unknown keys.

```javascript
const fontSize = app.settings.get("editor.fontSize");
const wordWrap = app.settings.get("editor.wordWrap");
```

### set(key, value)

Set a setting value. Changes are persisted automatically (debounced).

```javascript
app.settings.set("theme", "monokai");
app.settings.set("editor.fontSize", 16);
app.settings.set("editor.wordWrap", "on");
```

## Events

### onChanged

Subscribe to setting changes:

```javascript
const sub = app.settings.onChanged.subscribe(({ key, value }) => {
    console.log(`${key} changed to`, value);
});

// To unsubscribe later:
sub.dispose();
```
