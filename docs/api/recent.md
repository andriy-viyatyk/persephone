[← API Reference](./index.md)

# app.recent

Access and manage the list of recently opened files.

**Important:** The file list is loaded lazily. `files` returns `[]` until `load()` has been called.

```javascript
await app.recent.load();
console.log(app.recent.files); // ["C:/file1.txt", "C:/file2.json", ...]
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `files` | `string[]` | Recent file paths (most recent first). Empty until `load()` is called. |

## Methods

### load() → `Promise<void>`

Load the recent files list from disk. Must be called at least once before `files` returns data. Safe to call multiple times (reloads each time).

### add(filePath) → `Promise<void>`

Add a file path to the top of the list. Deduplicates and caps at 100 entries.

```javascript
await app.recent.add("C:/data/report.json");
```

### remove(filePath) → `Promise<void>`

Remove a file path from the list.

### clear() → `Promise<void>`

Clear all recent files.

## Example

```javascript
// List recent JSON files
await app.recent.load();
const jsonFiles = app.recent.files.filter(f => f.endsWith(".json"));
return jsonFiles.join("\n");
```
