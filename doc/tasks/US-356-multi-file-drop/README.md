# US-356: Multi-File Drop Handler

**Epic:** EPIC-018 (Phase 2, task 2.3)
**Status:** Planned
**Created:** 2026-04-05

## Goal

When multiple files are dropped onto Persephone, open a link collection page (via `openLinks()`) showing all dropped files in the "Links" sidebar panel. Keep current single-file behavior unchanged — one dropped file opens directly in a new page.

## Background

### Current implementation

File drops are handled in [GlobalEventService.ts](../../src/renderer/api/internal/GlobalEventService.ts) `captureDrop()` method (line 56):

```typescript
private captureDrop = (e: DragEvent) => {
    let filePath: string | undefined = undefined;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];  // ← ONLY FIRST FILE
        try {
            filePath = window.electron.getPathForFile(file);
        } catch (error) {
            console.error("Error getting file path:", error);
        }
    }

    if (!filePath) {
        const textData = e.dataTransfer.getData("text/plain");
        filePath = textData?.split("\n")[0]?.trim();
    }

    if (filePath && fs.fileExistsSync(filePath)) {
        e.preventDefault();
        e.stopPropagation();
        window.electron.ipcRenderer.sendMessage(RendererEvent.fileDropped, filePath);
    }
};
```

The flow is:
1. Renderer `captureDrop` → extracts `files[0]` path only
2. Sends IPC `RendererEvent.fileDropped` (single string) to main process
3. Main process bounces it back via `EventEndpoint.eOpenFile`
4. Renderer `handleOpenFile` → `openRawLink(filePath)`

### What changes

- **1 file dropped**: keep current behavior — IPC → `openRawLink` → opens in new page
- **2+ files dropped**: call `pagesModel.openLinks(filePaths)` directly in the renderer (no IPC round-trip needed)

## Implementation Plan

### Step 1: Modify `captureDrop` in GlobalEventService

**File:** `src/renderer/api/internal/GlobalEventService.ts`

Replace the current single-file logic with multi-file handling:

```typescript
private captureDrop = (e: DragEvent) => {
    // Extract all file paths from the drop event
    const filePaths: string[] = [];

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            try {
                const path = window.electron.getPathForFile(e.dataTransfer.files[i]);
                if (path && fs.fileExistsSync(path)) {
                    filePaths.push(path);
                }
            } catch (error) {
                console.error("Error getting file path:", error);
            }
        }
    }

    // Fallback to text/plain data (e.g., text dragged from another app)
    if (filePaths.length === 0) {
        const textData = e.dataTransfer.getData("text/plain");
        const path = textData?.split("\n")[0]?.trim();
        if (path && fs.fileExistsSync(path)) {
            filePaths.push(path);
        }
    }

    if (filePaths.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    if (filePaths.length === 1) {
        // Single file — keep existing behavior (IPC round-trip → openRawLink)
        window.electron.ipcRenderer.sendMessage(RendererEvent.fileDropped, filePaths[0]);
    } else {
        // Multiple files — open link collection page
        pagesModel.openLinks(filePaths);
    }
};
```

**Imports to add:**
```typescript
import { pagesModel } from "../pages";
```

Note: `pagesModel` is a singleton imported from `../pages`. `GlobalEventService` already imports from the api layer (`fs`, `ui`, `appWindow`), so this is consistent.

## Concerns (all resolved)

### 1. Category generation from folder structure
When dropping files from different folders, should we create categories based on directory structure?

**Resolution:** No — `openLinks()` receives flat file paths. Category extraction is a future enhancement. All files go to the root category.

### 2. Folder drops
When a folder is dropped, should we enumerate its contents?

**Resolution:** Out of scope. A dropped folder is treated as a single entry (directory link). `fs.fileExistsSync()` returns true for directories, so the path is valid. The link will appear in the collection but clicking it would open it in Explorer. Future task could enumerate folder contents.

### 3. Text/plain fallback for multi-file
The current text/plain fallback only takes the first line. Should we handle multiple lines?

**Resolution:** Keep as single-line fallback. The text/plain path is rare (non-file drags) and multi-line parsing is fragile. Only the `files` API provides reliable multi-file data.

## Acceptance Criteria

1. **Single file drop**: unchanged — file opens in a new page directly
2. **Multi-file drop**: creates a link collection page with all files in the "Links" sidebar panel
3. **Clicking a link**: navigates the page's main area to that file (handled by existing `openLinks()` infrastructure)
4. **Invalid paths**: files that don't exist are silently skipped
5. **Mixed valid/invalid**: only valid file paths appear in the collection

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/internal/GlobalEventService.ts` | Modify `captureDrop` to handle multiple files via `pagesModel.openLinks()` |

### Files NOT changed

- `PagesLifecycleModel.ts` — `openLinks()` already implemented (US-355)
- `RendererEventsService.ts` — single-file IPC path unchanged
- `renderer-events.ts` (main process) — single-file IPC path unchanged
- `api-types.ts` — no new IPC events
