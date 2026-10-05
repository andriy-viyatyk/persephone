---
title: "app.window"
audience: user
summary: "Minimize, maximize, zoom, and multi-window management."
---

# app.window

Window management: minimize, maximize, zoom, and multi-window support.

```javascript
app.window.maximize();
app.window.zoom(1);  // zoom in one step
```

## Window Actions

| Method | Description |
|--------|-------------|
| `minimize()` | Minimize to taskbar. |
| `maximize()` | Maximize the window. |
| `restore()` | Restore from maximized/minimized. |
| `close()` | Close the window. |
| `toggleWindow()` | Toggle between maximized and restored. |

## Window State

| Property | Type | Description |
|----------|------|-------------|
| `isMaximized` | `boolean` | Whether the window is maximized. Read-only, updated reactively. |
| `windowIndex` | `number` | Zero-based index among all app windows. Read-only. |

## Menu Bar

| Member | Type | Description |
|--------|------|-------------|
| `menuBarOpen` | `boolean` | Whether the sidebar is open. Read-only. |
| `menuBar` | `IMenuBar` | Live Menu Bar model with folders, selection, and controls. |
| `toggleMenuBar()` | `void` | Toggle sidebar open/closed. |
| `openMenuBar(panelId?)` | `void` | Legacy sidebar opener. An unknown string still opens the sidebar without changing selection. |

### `menuBar`

The Menu Bar is the sidebar opened from the Persephone icon. Its folder list is live and includes
the built-in folders plus any configured user folders.

| Member | Type | Description |
|--------|------|-------------|
| `isOpen` | `boolean` | Whether the Menu Bar is open. |
| `folders` | `IMenuBarFolder[]` | Folder records with `id`, `label`, `kind`, and an optional `path`. |
| `selected` | `IMenuBarFolder` | Currently selected folder. |
| `open(folderId?)` | `void` | Open the Menu Bar, optionally selecting a folder by its ID. IDs are strict; labels, paths, and stale IDs are rejected. |
| `close()` | `void` | Close the Menu Bar. Repeating the call is safe. |

The built-in folder IDs are `open-tabs`, `recent-files`, `tools-editors`, and `script-library`.
Read `folders` before opening a configured user folder so you use its current ID.

## `window.screen`

`window.screen` automates Persephone's own window and the currently active page. It can inspect the
app chrome, tab strip, sidebar, toolbars, dialogs, and active editor using CSS selectors or refs from
an accessibility snapshot. It does not open or switch pages; use `app.pages` and
`app.pages.showPage()` for that.

```javascript
const snapshot = await app.window.screen.snapshot();
await app.window.screen.click({ ref: "e12" });
await app.window.screen.waitFor({ text: "Settings" });
```

The shared page automation methods are also available here, including `check()`, `uncheck()`,
`clear()`, `drag()`, `fillForm()`, `setInputFiles()`, `keyDown()`, `keyUp()`, `waitForResponse()`,
`dialogs()`, `handleDialog()`, `consoleMessages()`, and `pageErrors()`. `snapshot()` accepts
`root`, `interactive`, `maxNodes`, and `maxChars`; element methods accept either a CSS selector or
`{ ref: "eN" }` from a snapshot. `waitFor()` accepts exactly one of `selector`, `text`, `textGone`,
or `time`, with an optional `timeout` in milliseconds. Mouse and keyboard actions use trusted input
and check target actionability by default. See [Browser, board, and window page automation](./page.md#browser-board-and-window-page-automation)
for locator, wait, screenshot, and response details. The `screenshot()` result is an image object
when the capture is available.

String locators also support `text=`. Quoted text is an exact, case-sensitive match after whitespace
normalization (`text="Open File"`); unquoted text is a case-insensitive substring after trimming and
collapsing whitespace (`text=Open File`). Nested visible matches prefer the smallest element, and
`nth` selects within that list. The shared locator works on app-window, browser-page, and board
targets.

`clickAt({ x, y })` and `dragTo({ from, to })` use trusted input at renderer viewport CSS pixels,
originating at the top-left. Get coordinates from `window.screen.evaluate()` and
`getBoundingClientRect()`. `clickAt()` bypasses locator actionability; ordinary `click()` keeps its
checks. `dragTo()` uses the same dispatch path as `drag()` and preserves HTML5 drag data.

The app-window host follows the browser privacy guard: it cannot automate a user-opened incognito or
Tor page while that page is active. Agent-opened private pages remain available to that agent.

### `window.screen.recording`

Record the visible Persephone window, active page, or its main editor area. Agent `start()` prepares
and starts immediately; `hideStatusChrome: true` hides recording controls and the MCP indicator and
restores their prior visibility on stop, cancel, and error. `openPlayer` defaults
to `false`, so the finished file remains temporary and closed. Copy the returned path elsewhere to
keep it beyond the seven-day cleanup window. With `openPlayer: true`, closing the player page without
**Save as…** deletes the recording, so copy it first.

```javascript
await app.window.screen.recording.start({ region: "editor", hideStatusChrome: true });
await app.window.screen.recording.pause();
await app.window.screen.recording.resume();
const result = await app.window.screen.recording.stop();
// result: { path, durationMs, mimeType, width, height, stoppedBy }
await app.fs.copyFile(result.path, "C:/Videos/persephone-demo.mp4");
```

Use `cancel()` to discard an unfinished capture. `state` is a read-only snapshot with `status`,
`elapsedMs`, the active `region`, and the most recent finished result in `last`. `stop()` can retrieve
that result if the user stopped an agent-started recording. Set `openPlayer: true` to open playback;
temporary player pages offer **Save as…** and **Discard**. Capture is video-only at 30 fps and refuses
to run while a user-opened incognito or Tor page is active.

## Zoom

| Member | Type | Description |
|--------|------|-------------|
| `zoom(delta)` | `void` | Zoom in (positive) or out (negative). E.g., `1` or `-1`. |
| `resetZoom()` | `void` | Reset zoom to 100%. |
| `zoomLevel` | `number` | Current zoom level (0 = 100%). Read-only, updated reactively. |

```javascript
app.window.zoom(2);    // zoom in 2 steps
app.window.zoom(-1);   // zoom out 1 step
app.window.resetZoom(); // back to 100%
```

## Multi-Window

### openNew(filePath?) → `Promise<number>`

Open a new application window. Returns the new window's index.

```javascript
// Open empty window
await app.window.openNew();

// Open window with a file
await app.window.openNew("C:/data/report.json");
```
