# IRecentFiles — `app.recent`

**Status:** Implemented (Phase 1)

Access and manage the list of recently opened files.

## Access

```javascript
app.recent
```

## Properties

### `files` (read-only)

Currently loaded list of recent file paths, most recent first.

```javascript
const files = app.recent.files;
// ["C:/docs/notes.txt", "C:/code/index.ts", ...]
```

**Type:** `string[]`

**Important:** Returns `[]` until `load()` has been called — either by the sidebar UI or manually by a script. See `load()` below.

---

## Methods

### `load()`

Load the recent files list from disk. Must be called at least once before `files` returns data.

```javascript
await app.recent.load();
console.log(app.recent.files);
```

**Returns:** `Promise<void>`

**Notes:**
- The sidebar calls `load()` automatically when opened
- Safe to call multiple times — reloads from disk each time
- Scripts should call `load()` before reading `files` if the sidebar hasn't been opened yet

---

### `add(filePath)`

Add a file path to the top of the recent list. Deduplicates automatically — if the path already exists, it moves to the top. List is capped at 100 entries.

```javascript
await app.recent.add("C:/docs/notes.txt");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute file path |

**Returns:** `Promise<void>`

**Side effects:** Persisted to disk immediately.

---

### `remove(filePath)`

Remove a file path from the recent list.

```javascript
await app.recent.remove("C:/docs/old-file.txt");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | File path to remove |

**Returns:** `Promise<void>`

**Side effects:** Persisted to disk immediately.

---

### `clear()`

Clear all recent files.

```javascript
await app.recent.clear();
```

**Returns:** `Promise<void>`

**Side effects:** Persisted to disk immediately.

---

## Examples

### Read recent files in a script

```javascript
await app.recent.load();
const files = app.recent.files;
console.log(`${files.length} recent files`);
files.slice(0, 5).forEach(f => console.log(f));
```

### Remove files that no longer exist

```javascript
await app.recent.load();
for (const file of app.recent.files) {
    // Check file existence using Node.js fs
    const fs = require("fs");
    if (!fs.existsSync(file)) {
        await app.recent.remove(file);
    }
}
```

---

## Implementation Notes

- Backed by `recentFiles.txt` in the app data directory (one path per line)
- `files` is a snapshot, not reactive — scripts get the value at time of access
- React components use `recent.useFiles()` for reactive updates (not exposed in `.d.ts`)
- The sidebar's `RecentFileList.tsx` calls `load()` in its `useEffect`
