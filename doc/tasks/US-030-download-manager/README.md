# US-030: Browser Download Progress & History

## Status

**Status:** Completed
**Priority:** Medium
**Started:** 2026-02
**Completed:** 2026-02
**Depends on:** US-025 (Basic Browser Editor)

## Summary

Add download progress tracking and a download history popup to the browser editor toolbar. Reuses Electron's existing download functionality (save dialog + `DownloadItem` API) — no custom HTTP requests, no separate page-editor. Just a toolbar button with circular progress and a floating panel showing active/recent downloads.

## Why

- Electron's built-in download already works (save dialog appears, file downloads) — but there's no progress indicator or way to see recent downloads
- Users can't tell if a download is still in progress or finished
- No way to quickly open a downloaded file or its folder after download

## Acceptance Criteria

- [x] Download button on browser toolbar (between Bookmarks and DevTools buttons)
- [x] Button always visible; uses active/selected color when downloads are in progress
- [x] Circular progress ring around the button while downloads are active
- [~] Badge showing count of active downloads — skipped (progress ring sufficient)
- [x] Clicking the button opens a Popper with scrollable download list
- [x] Most recent downloads shown at the top
- [x] Each download shows: filename, progress (if active), status (downloading/completed/failed/cancelled)
- [x] Active downloads: progress bar + cancel button
- [x] Completed downloads: "Open" and "Show in Folder" buttons
- [x] Failed downloads: error status displayed
- [x] Global download list — shared across all browser pages (not per-page)
- [x] Last 5 completed downloads persisted to `{userData}/data/recentDownloads.json` and restored on app restart
- [x] `will-download` handled on webview sessions — uses our own save dialog (`dialog.showSaveDialogSync`) for reliable path capture
- [x] No auto-open popup when a download starts
- [x] No regressions to existing browser functionality
- [x] Documentation updated

## Architecture

### How It Works

Electron's existing flow is preserved:
1. User clicks a download link in the webview
2. Electron fires `will-download` on the session → save dialog appears
3. User picks location → download starts via `DownloadItem`
4. **New:** Main process tracks `DownloadItem` events (progress, done, failed) and sends IPC updates to renderer
5. **New:** Browser toolbar button shows progress ring + badge
6. **New:** Clicking the button shows a Popper with download list and actions

### Process Flow

```
Webview (guest)              Main Process                    Renderer (Browser editor)
───────────────          ─────────────────────          ──────────────────────────────
click download link  →   session.will-download
                         save dialog (built-in)
                         DownloadItem tracking
                           .on('updated')        →      IPC: download-progress
                           .on('done')           →      IPC: download-completed
                                                        toolbar button: progress ring
                                                        popup panel: download list
                                                 ←      IPC: cancel-download
                                                 ←      IPC: open-download
                                                 ←      IPC: show-in-folder
```

### Key Design Decisions

- **No separate page-editor** — download UI lives entirely in the browser toolbar Popper
- **Keep Electron's save dialog** — no custom download directory setting needed
- **Main-process is the single source of truth** — `download-service.ts` holds the authoritative `DownloadEntry[]` in memory, tracks `DownloadItem` events, and broadcasts updates to all renderer windows via `openWindows.send()`. Renderer stores are thin views that init from `getDownloads()` and stay in sync via events.
- **Multi-window support** — download events broadcast to all open windows (same pattern as `eOpenFile`, `eOpenUrl`, etc.). A window opened after a download started calls `getDownloads()` to catch up.
- **Global download list** — downloads are shared across all browser pages and all windows; closing one browser page and opening another still shows the same downloads
- **Persistence** — last 5 completed downloads saved to `{userData}/data/recentDownloads.json` (similar to `recentFiles.txt`); restored on app restart so user can still open/locate recently downloaded files
- **No custom HTTP requests** — reuses Electron's download pipeline so headers, cookies, and site protections all work correctly
- **Reuse Popper component** — `src/renderer/components/overlay/Popper.tsx` for the popup panel (project standard, supports click-outside close, escape, positioning via Floating UI)
- **No auto-open popup** — button changes appearance to signal activity, user clicks to see details

## Files to Create

- `src/main/download-service.ts` — Main-process download tracking: listens on `will-download`, tracks `DownloadItem` progress/completion, sends IPC events, persists last 5 completed downloads to disk
- `src/renderer/store/downloads-store.ts` — Global download state store (list of downloads, active count, aggregate progress, persistence load/save)
- `src/renderer/editors/browser/BrowserDownloadsPopup.tsx` — Popper panel UI (scrollable download list, progress bars, action buttons)
- `src/renderer/editors/browser/DownloadButton.tsx` — Toolbar button with SVG circular progress ring and badge

## Files to Modify

- `src/ipc/api-types.ts` — Add download IPC endpoint enums and event types
- `src/ipc/main/controller.ts` — Add download action handlers (cancel, open, show-in-folder, get-downloads)
- `src/ipc/renderer/api.ts` — Add download action proxy methods
- `src/ipc/renderer/renderer-events.ts` — Add download event subscriptions
- `src/main/main-setup.ts` — Wire download service on webview session creation
- `src/renderer/editors/browser/BrowserPageView.tsx` — Add download button to toolbar

## Implementation Progress

### Phase 1: Main-Process Download Tracking
- [x] Create `download-service.ts`
- [x] Listen to `will-download` on webview sessions (all partitions)
- [x] Track `DownloadItem` with unique ID: filename, savePath, totalBytes, receivedBytes, status
- [x] Forward events to renderer via IPC: started, progress (throttled ~500ms), completed, failed, cancelled
- [x] Handle cancel request from renderer (`downloadItem.cancel()`)
- [x] Handle open file request (`shell.openPath()`)
- [x] Handle show in folder request (`shell.showItemInFolder()`)
- [x] Persist last 5 completed downloads to `{userData}/data/recentDownloads.json`
- [x] Provide `getDownloads` endpoint to return current download list (for renderer init)

### Phase 2: Browser Toolbar Button
- [x] Create `DownloadButton.tsx` — SVG circle progress ring around download icon
- [x] Button always visible with default color; active/selected color when downloads are in progress
- [x] Progress ring: stroke-dasharray animation based on aggregate progress of active downloads
- [x] Add to toolbar in `BrowserPageView.tsx` between Bookmarks and DevTools

### Phase 3: Download List Popup
- [x] Create global `downloads-store.ts` — download state, IPC subscriptions, persistence
- [x] Create `BrowserDownloadsPopup.tsx` — Popper panel positioned below the download button
- [x] Scrollable list showing all downloads (most recent at top)
- [x] Download entry: filename (truncated, full path in tooltip), progress bar (active), status text, action buttons
- [x] Active: animated progress bar + cancel button
- [x] Completed: "Open" + "Show in Folder" buttons
- [x] Failed/Cancelled: status text
- [x] "Clear All" button to dismiss completed/failed entries
- [x] Load persisted downloads on app startup via `getDownloads` endpoint

## Download Data Model

```typescript
interface DownloadEntry {
    id: string;              // Unique ID assigned by main process
    filename: string;        // Display filename
    url: string;             // Source URL
    savePath: string;        // Full save path (after user picks location)
    totalBytes: number;      // Total file size (0 if unknown)
    receivedBytes: number;   // Bytes downloaded so far
    status: "downloading" | "completed" | "failed" | "cancelled";
    startTime: number;       // Timestamp
    error?: string;          // Error message if failed
}
```

## Persistence Format

```json
// {userData}/data/recentDownloads.json
// Last 5 completed downloads (most recent first)
[
    {
        "id": "dl-1709071234567",
        "filename": "report.pdf",
        "savePath": "C:\\Users\\...\\Downloads\\report.pdf",
        "url": "https://example.com/report.pdf",
        "status": "completed",
        "totalBytes": 1048576,
        "startTime": 1709071234567
    }
]
```

Saved via `filesModel.saveDataFile()` / loaded via `filesModel.getDataFile()` (same pattern as `recentFiles.txt`).

## IPC Channels

```typescript
// Events (main → renderer, broadcast to ALL windows via openWindows.send())
EventEndpoint.eDownloadStarted    // DownloadEntry (initial)
EventEndpoint.eDownloadProgress   // { id, receivedBytes, totalBytes }
EventEndpoint.eDownloadCompleted  // { id }
EventEndpoint.eDownloadFailed     // { id, error }

// Requests (renderer → main)
Endpoint.cancelDownload           // (id) → void
Endpoint.openDownload             // (id) → void
Endpoint.showDownloadInFolder     // (id) → void
Endpoint.getDownloads             // () → DownloadEntry[] (persisted + active)
```

## UI Mockup

### Toolbar Button States

```
No downloads:        [↓]           — default button color
Active (1):          [↓◔]          — active/selected color + circular progress ring
Active (2+):         [↓◔] ②       — active/selected color + progress ring + count badge
```

### Popup Panel (Popper)

```
┌─ Downloads ──────────────────── ✕ ─┐
│  ┌─────────────────────────────┐   │
│  │ (scrollable)                │   │
│  │                             │   │
│  │  📄 installer-v1.0.16.exe  │   │
│  │  ████████████░░░░░░░  62%  [✕]  │
│  │                             │   │
│  │  📄 report.pdf              │   │
│  │  Completed [Open] [Folder]  │   │
│  │                             │   │
│  │  📄 data.csv                │   │
│  │  Failed: Network error      │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                    [Clear completed]│
└─────────────────────────────────────┘
```

## Concerns

1. **Webview session access**: Need to hook `will-download` on each webview's session. Must handle all partition types (default, profile-specific, incognito). The browser editor already creates sessions per profile — need to find the right hook point.

2. **Progress throttling**: `DownloadItem.on('updated')` fires frequently. Should throttle IPC progress events to ~500ms intervals to avoid flooding the renderer.

3. **Large file names**: Need truncation in the popup UI. Show full path in tooltip.

4. **Persistence limit**: Only persist last 5 completed downloads. Active downloads are not persisted (they won't survive app restart anyway).

5. **Multi-window sync**: Resolved — main process is the single source of truth. Events broadcast to all windows via `openWindows.send()`. New windows call `getDownloads()` on init to catch up.

## Notes

- Simplified from original plan which was a full standalone page-editor with programmatic download API
- Electron's `DownloadItem` API provides: `getFilename()`, `getTotalBytes()`, `getReceivedBytes()`, `getSavePath()`, `getURL()`, `cancel()`, `pause()`, `resume()`, `on('updated')`, `on('done')`
- `shell.openPath(path)` opens file with default app
- `shell.showItemInFolder(path)` opens Explorer with file selected
- Popper component (`src/renderer/components/overlay/Popper.tsx`) handles positioning, click-outside close, escape key, and scroll overflow
- Recent files use `filesModel.saveDataFile()` / `getDataFile()` for persistence to `{userData}/data/` — same pattern for downloads

## Related

- Depends on: US-025 (Basic Browser Editor)
- Integrates with: US-027 (Browser Profiles — session partitions)
