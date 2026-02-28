# Application Lifecycle

Describes the complete lifecycle of the js-notepad application — from process startup to quit. Covers both the main process (Electron) and renderer process (React), with special attention to multi-window behavior.

Understanding this lifecycle is essential for knowing where `app.init()` fits, when services are ready, and how windows coordinate.

---

## Process Architecture

js-notepad is a **single-instance, multi-window** Electron application.

```
┌─────────────────────────────────────────┐
│           MAIN PROCESS (one)            │
│                                         │
│  OpenWindows (window manager)           │
│  IPC Controller (25+ endpoints)         │
│  Services: Version, Download, Search    │
│  Pipe Server (single-instance)          │
│  System Tray                            │
└────────┬──────────────┬─────────────────┘
         │              │
    ┌────▼────┐    ┌────▼────┐
    │ Window 0│    │ Window 1│    ... (N windows)
    │(renderer│    │(renderer│
    │ process)│    │ process)│
    └─────────┘    └─────────┘
```

**Key facts:**
- Single main process, multiple renderer processes (one per window)
- Each window has its own `app` object, stores, and React tree
- Windows are independent — no shared memory, communicate via main process IPC
- Settings file on disk is the only shared state (watched by FileWatcher for cross-window sync)

---

## 1. Application Startup

### Main Process Boot Sequence

```
app launch
  │
  ├─ 1. Request single-instance lock
  │     └─ If lock fails → send args via named pipe to existing instance → quit
  │
  ├─ 2. app.on("ready")
  │     ├─ Register custom protocols (app-asset://, safe-file://)
  │     ├─ Initialize IPC controller (bind 25+ API endpoints)
  │     ├─ Initialize services:
  │     │     ├─ Search service handlers
  │     │     ├─ Browser service handlers
  │     │     └─ Download service
  │     ├─ Set up session protocol handlers
  │     ├─ openWindows.restoreState()  ← restore windows from previous session
  │     ├─ Setup system tray (Windows)
  │     ├─ Start named pipe server
  │     └─ setTimeout(5s): check for updates
  │
  ├─ 3. app.on("second-instance")
  │     └─ Handle command-line args: file paths, URLs, diff mode
  │
  ├─ 4. app.on("window-all-closed")
  │     └─ Windows/Linux: app.quit()
  │
  └─ 5. app.on("will-quit")
        └─ Stop pipe server
```

### Window Creation

When `openWindows.restoreState()` runs (or a new window is requested):

```
openWindows.createWindow(index)
  │
  ├─ 1. Create BrowserWindow
  │     ├─ Restore saved position/size from electron-store
  │     ├─ Ensure window is visible on current display
  │     ├─ nodeIntegration: true, contextIsolation: false
  │     └─ show: false (shown after ready-to-show)
  │
  ├─ 2. Subscribe to window events
  │     ├─ ready-to-show → fix size, show window
  │     ├─ close → coordinate graceful shutdown (see "Window Close")
  │     ├─ maximize/unmaximize → notify renderer
  │     ├─ resize/move → debounced save position
  │     └─ keyboard → zoom controls (Ctrl+/-)
  │
  ├─ 3. Set up navigation guards
  │     ├─ Intercept window.open()
  │     └─ Intercept will-navigate (prevent navigation outside app)
  │
  ├─ 4. Load renderer HTML
  │     ├─ Dev: Vite dev server URL
  │     └─ Prod: prebuilt index.html
  │
  └─ 5. Create whenReady promise
        └─ Resolved when renderer calls api.windowReady()
```

---

## 2. Window (Renderer) Boot Sequence

Each window runs its own renderer process with independent stores and React tree.

### Current Initialization Order

```
Module load (file scope — runs on import)
  │
  ├─ filesModel = new FilesModel()
  │     └─ filesModel.init() — async, resolves data paths via IPC
  │
  ├─ appSettings = new AppSettings()
  │     └─ constructor calls init() — async, waits for filesModel, reads settings file
  │
  ├─ pagesModel = new PagesModel()
  │     └─ pagesModel.init() — async, restores pages from disk
  │
  └─ React renders <AppContent>
        ├─ <EventHandler> mounts → downloadsStore.init(), global listeners
        ├─ <MainPage> mounts → keyboard shortcuts, window state subscriptions
        └─ pagesModel.init() completes:
              ├─ Pages restored from cache
              ├─ IPC event subscriptions set up
              └─ api.windowReady() → signals main process
```

**Problem with current order:** Stores init asynchronously at module load. React may render before stores are ready. No guarantee of readiness.

### New Initialization Order (with `app.init()`)

```
Module load
  │
  └─ React NOT rendered yet
        │
        ▼
bootstrap()
  │
  ├─ await app.init()     ← all services init in parallel
  │     ├─ filesModel paths resolved
  │     ├─ appSettings loaded from disk
  │     ├─ recentFiles loaded
  │     ├─ pagesModel restores pages
  │     └─ IPC events subscribed
  │
  ├─ React renders <AppContent>    ← safe to read app.settings.theme etc.
  │     ├─ <EventHandler> mounts
  │     ├─ <MainPage> mounts
  │     └─ All stores are ready
  │
  └─ api.windowReady()    ← signal main process: renderer is ready
```

**Benefits:**
- Deterministic initialization order
- React renders only after all services are ready
- `app.init()` parallelizes independent async work via `Promise.all`
- Main process knows exactly when window is ready to receive events

---

## 3. Window Lifecycle States

```
  ┌──────────┐    ┌────────────┐    ┌──────────┐    ┌─────────┐
  │ Creating  ├───►│Initializing├───►│  Active   ├───►│ Closing  │
  └──────────┘    └────────────┘    └────┬─────┘    └────┬────┘
                                         │               │
                                    ┌────▼────┐    ┌─────▼──────┐
                                    │ Hidden   │    │  Destroyed  │
                                    │ (tray)   │    └────────────┘
                                    └─────────┘
```

### Creating

BrowserWindow created, HTML loading. Renderer process starts.

### Initializing

`app.init()` running. Stores loading. Pages restoring from disk.

Ends when `api.windowReady()` is called — resolves main process `whenReady` promise.

### Active

Normal operation. User interacts with pages. Events flow between main and renderer.

**During Active state:**
- Pages can be opened, closed, grouped, moved
- Settings can change (synced via FileWatcher across windows)
- Downloads can start/progress/complete
- New windows can be created (drag tab out, "Open in new window")

### Hidden (Last Window)

When the user closes the last window, it is **hidden** instead of destroyed. The app continues running via system tray.

- `openWindows.setCanQuit()` detects last window → `window.hide()`
- Tray click → `showWindows()` restores it
- State is preserved — pages remain in memory

### Closing

See "Window Close Flow" below.

### Destroyed

BrowserWindow is closed and garbage collected. Renderer process terminates.

---

## 4. Window Close Flow

### User Closes a Window

```
User clicks X (or Ctrl+W on last tab, etc.)
  │
  ▼
Main: BrowserWindow "close" event
  │
  ├─ canQuit === false? (default)
  │     ├─ event.preventDefault()     ← don't close yet
  │     └─ Send eBeforeQuit to renderer
  │
  ▼
Renderer: pagesModel.onAppQuit()
  │
  ├─ Save all page states in parallel
  │     └─ Promise.all(pages.map(p => p.saveState()))
  │           ├─ Flush unsaved content to cache
  │           ├─ Flush nav panel state
  │           └─ Flush component state (grid, notebook, etc.)
  │
  ├─ Save window state to disk
  │     └─ Page list, groupings, active page → openFiles-{index}.json
  │
  └─ api.setCanQuit(true)
        │
        ▼
Main: openWindows.setCanQuit()
  │
  ├─ Is this the LAST window?
  │     ├─ YES + doQuit === false → window.hide() (tray mode)
  │     └─ NO (or doQuit === true) → window.close()
  │
  ▼ (if close proceeds)
Main: windowOnClose callback
  │
  ├─ Multiple windows + no modified/pinned pages?
  │     └─ YES → delete window state file
  │     └─ NO → keep state, clear window reference
  │
  └─ If no windows remain → app.quit()
```

### App Quit (Explicit)

Triggered by: Tray → Quit, or system shutdown.

```
openWindows.doQuit = true
app.quit()
  │
  ├─ Each window receives close event
  │     └─ Same eBeforeQuit → save → setCanQuit flow
  │     └─ But: doQuit=true means last window IS closed (not hidden)
  │
  ├─ app.on("will-quit")
  │     └─ stopPipeServer()
  │
  └─ Process exits
```

---

## 5. Multi-Window Coordination

### How Windows Know About Each Other

Windows don't directly communicate. Everything goes through the main process:

```
Window 0 ──IPC──► Main Process ──IPC──► Window 1
```

**Main process tracks all windows** via `openWindows.windows[]` array:
- Each entry: `{ index, window (BrowserWindow | null), whenReady (Promise), ready (boolean) }`
- `openWindows.send(event, data)` broadcasts to ALL windows
- `window.send(event, data)` sends to a specific window

### Moving a Page Between Windows

```
Source Window                Main Process              Target Window
     │                           │                           │
     │  api.movePageToWindow()   │                           │
     ├──────────────────────────►│                           │
     │                           │  eMovePageOut(pageId)     │
     │◄──────────────────────────┤                           │
     │                           │                           │
     │  page.saveState()         │  Create window if needed  │
     │  remove page              │  Wait for whenReady       │
     │  (NO dispose)             │──────────────────────────►│
     │                           │                           │
     │                           │  eMovePageIn(pageData)    │
     │                           ├──────────────────────────►│
     │                           │                           │
     │                           │        restore page       │
     │                           │        add to workspace   │
     │                           │                           │
```

**Key details:**
- Page is NOT disposed in source — cache files remain on disk for target to use
- `page.skipSave = true` prevents re-save during detach
- Target creates a fresh model from serialized state + calls `restore()`
- FileWatchers are recreated from scratch in the target window

### Settings Sync Between Windows

No real-time sync mechanism — windows are independent. But:

1. `appSettings` writes to shared `appSettings.json` file
2. Each window's `AppSettings` has a `FileWatcher` on that file
3. When Window A saves settings → file changes → Window B's FileWatcher detects → reloads

This means settings eventually sync, with a delay (FileWatcher debounce + disk I/O).

### Shared Persistent State

| File | Scope | Contents |
|------|-------|----------|
| `appSettings.json` | Shared (all windows) | Theme, browser profiles, search settings |
| `openWindows.json` | Shared (all windows) | List of open window indices |
| `openFiles-{N}.json` | Per-window | Pages, groupings, active page |
| `recentFiles.txt` | Shared (all windows) | Recent file paths |
| `cache/{pageId}.txt` | Per-page (any window) | Unsaved page content |
| `cache-misc/` | Shared | Favicons, etc. |

---

## 6. Named Pipe Server (Single Instance)

On Windows, ensures only one app instance runs:

```
Pipe: \\.\pipe\js-notepad-{username}

Protocol:
  OPEN <filepath>    → open file in existing instance
  OPEN <url>         → open URL
  OPEN               → bring to front
  SHOW               → bring to front
  DIFF <p1>\t<p2>    → show diff view
  END                → close connection
```

**Flow:**
1. App starts → tries `requestSingleInstanceLock()`
2. If lock acquired → start pipe server, normal startup
3. If lock fails → another instance is running:
   - Launcher sends command via named pipe to existing instance
   - Quit this instance
4. Existing instance receives pipe message → opens file/URL in focused window

---

## 7. Where `app.init()` Fits

In the new architecture, `app.init()` replaces the current scattered async initialization:

### Current (scattered, no guarantees)

```
Module load:
  filesModel.init()          ← fire and forget
  appSettings.init()         ← fire and forget (waits for filesModel internally)
  pagesModel.init()          ← fire and forget (waits for filesModel internally)

React renders:               ← may run before inits complete
```

### New (centralized, guaranteed)

```
bootstrap():
  await app.init()
    ├─ Stage 1: Platform (parallel)
    │     ├─ filesModel.init()        ← resolve data paths
    │     └─ (other platform services)
    │
    ├─ Stage 2: Services (parallel, depend on platform)
    │     ├─ appSettings.init()       ← read settings file
    │     ├─ recentFiles.load()       ← read recent files
    │     └─ editorRegistry ready     ← sync, already done
    │
    └─ Stage 3: Workspace
          ├─ pagesModel.restoreState()  ← restore pages
          └─ IPC event subscriptions

  React renders               ← everything is ready

  api.windowReady()           ← tell main process we're ready
```

Each window has its own `app.init()` call. The `app` object is per-window (same as stores are per-window).

---

## 8. Lifecycle Events (Proposed)

### Application-Level Events

```typescript
// Available via app object
app.onReady: IEvent<void>;           // app.init() completed (for plugins that load later)
app.onBeforeQuit: IEvent<void>;      // Window is about to close — save state
```

### Window-Level Events

```typescript
// Available via app.window
app.window.onMaximized: IEvent<boolean>;    // Window maximized/restored
app.window.onZoomChanged: IEvent<number>;   // Zoom level changed
app.window.onFocused: IEvent<void>;         // Window gained focus
app.window.onBlurred: IEvent<void>;         // Window lost focus
```

---

## Summary: Initialization Timeline

```
Time →

MAIN PROCESS:
  ▓▓▓▓ app ready ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ├─ IPC setup
  ├─ Services init
  ├─ restoreState (create windows)
  ├─ Tray + Pipe server
  └─ .............. whenReady resolves ............ update check

WINDOW 0 (renderer):
       ▓▓▓▓ HTML loads ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
       ├─ app.init()
       │  ├─ filesModel.init()  ─┐
       │  ├─ appSettings.init() ─┼─ parallel
       │  ├─ recentFiles.load() ─┘
       │  └─ pagesModel.restoreState()
       ├─ React renders
       └─ api.windowReady() ─────── ► main: whenReady resolves

WINDOW 1 (renderer, created later):
                    ▓▓▓▓ HTML loads ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                    ├─ app.init() (same flow, independent)
                    ├─ React renders
                    └─ api.windowReady()
```
