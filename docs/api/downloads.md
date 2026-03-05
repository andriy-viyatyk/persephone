[← API Reference](./index.md)

# app.downloads

Global download tracking. Manages download state synchronized from the main process. Used primarily by the Browser editor.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `downloads` | `DownloadEntry[]` | All tracked downloads. |
| `hasActiveDownloads` | `boolean` | True if any download is in progress. |
| `aggregateProgress` | `number` | Combined progress of all active downloads (0–1). |

## Methods

| Method | Description |
|--------|-------------|
| `cancelDownload(id)` | Cancel an active download. |
| `openDownload(id)` | Open a completed download file. |
| `showInFolder(id)` | Show a download in the OS file explorer. |
| `clearCompleted()` | Remove completed downloads from the list. |

## Example

```javascript
// List all downloads
app.downloads.downloads.forEach(d =>
    console.log(d.filename, d.state)
);

// Clear completed downloads
app.downloads.clearCompleted();
```
