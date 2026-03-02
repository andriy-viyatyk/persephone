# IDownloads — `app.downloads`

**Status:** Implemented (Phase 3b)

Global download tracking service. Manages download state synchronized from main process. Available across all windows.

## Access

```javascript
app.downloads
```

---

## Properties

### `downloads` (read-only)

Array of all downloads (active and completed).

```javascript
const allDownloads = app.downloads.downloads;
// [{ id, filename, status, receivedBytes, totalBytes, savePath?, error? }, ...]
```

**Type:** `DownloadEntry[]`

**DownloadEntry fields:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `string` | Unique download ID |
| `filename` | `string` | Downloaded file name |
| `status` | `"downloading" \| "completed" \| "cancelled" \| "failed"` | Download status |
| `receivedBytes` | `number` | Bytes downloaded |
| `totalBytes` | `number` | Total file size in bytes |
| `savePath` | `string \| undefined` | Full path where file was saved (only for completed downloads) |
| `error` | `string \| undefined` | Error message (only for failed downloads) |

---

### `hasActiveDownloads` (read-only)

`true` if any downloads are currently in progress.

```javascript
if (app.downloads.hasActiveDownloads) {
  console.log("Downloads in progress...");
}
```

**Type:** `boolean`

---

### `aggregateProgress` (read-only)

Combined progress of all active downloads as a fraction (0 to 1).

```javascript
const progress = app.downloads.aggregateProgress;
console.log(`${Math.round(progress * 100)}% complete`);
```

**Type:** `number` (0.0 to 1.0)

---

## Methods

### `cancelDownload(id)`

Cancel a download in progress.

```javascript
await app.downloads.cancelDownload("download-id-123");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `string` | Download ID to cancel |

**Returns:** `void`

**Side effects:**
- Download status changes to `"cancelled"`
- File transfer stops

**Error behavior:** No error if download already completed or doesn't exist.

---

### `openDownload(id)`

Open a completed download with its associated application.

```javascript
await app.downloads.openDownload("download-id-123");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `string` | Download ID (must be completed) |

**Returns:** `void`

**Side effects:**
- Opens file with OS default handler (e.g., opens PDF in reader)
- Brings window to foreground

**Error behavior:** Throws or silently fails if file not found or application error occurs.

---

### `showInFolder(id)`

Open the folder containing the downloaded file.

```javascript
await app.downloads.showInFolder("download-id-123");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `string` | Download ID (must be completed) |

**Returns:** `void`

**Side effects:**
- Opens file explorer/Finder to the download folder
- Highlights the file

**Error behavior:** Throws if folder or file not found.

---

### `clearCompleted()`

Remove all non-downloading downloads from the list (completed, failed, cancelled).

```javascript
app.downloads.clearCompleted();
```

**Parameters:** None

**Returns:** `void`

**Side effects:**
- Completed, failed, and cancelled downloads are removed from `downloads` array
- `hasActiveDownloads` and `aggregateProgress` update if active downloads remain
- Does NOT delete files from disk

**Error behavior:** No error if no downloads to clear.

---

## Examples

### Show current download status

```javascript
if (app.downloads.hasActiveDownloads) {
  const percent = Math.round(app.downloads.aggregateProgress * 100);
  console.log(`Downloading: ${percent}%`);
} else {
  console.log("No active downloads");
}
```

### List all active downloads

```javascript
const active = app.downloads.downloads.filter(d => d.status === "downloading");
active.forEach(d => {
  const percent = Math.round((d.receivedBytes / d.totalBytes) * 100);
  console.log(`${d.filename}: ${percent}%`);
});
```

### Cancel all downloads

```javascript
const active = app.downloads.downloads.filter(d => d.status === "downloading");
active.forEach(d => app.downloads.cancelDownload(d.id));
```

### Open a completed download

```javascript
const completed = app.downloads.downloads.find(d => d.status === "completed");
if (completed) {
  await app.downloads.openDownload(completed.id);
}
```

### Clean up after downloads finish

```javascript
// Monitor downloads and auto-clear when all finish
let hasActive = app.downloads.hasActiveDownloads;

setInterval(() => {
  const nowActive = app.downloads.hasActiveDownloads;
  if (hasActive && !nowActive) {
    console.log("All downloads finished, clearing list");
    app.downloads.clearCompleted();
  }
  hasActive = nowActive;
}, 1000);
```

---

## Design Notes

- **Global state:** Downloads are app-wide, not window-specific. All windows see the same list.
- **Persistence:** Download list is not persisted — clearing or restarting the app clears the list.
- **No file deletion:** `clearCompleted()` only updates the UI list; downloaded files remain on disk.
- **Main process managed:** Download events come from the Electron main process. State synchronizes across windows via IPC in real-time.
