# Browser Editor Architecture

> Read this before modifying or extending the browser editor.

## Overview

The browser editor embeds Chromium `<webview>` elements inside a tab, providing an in-app web browser with **multi-tab support**. Each browser page (persephone tab) contains its own set of internal browser tabs, displayed in a left-side panel. Unlike other editors that live entirely in the renderer process, the browser editor spans **three process boundaries** with IPC bridges between each.

## Tab Architecture

The browser editor uses three levels of tab nesting:

1. **Internal browser tabs** — Multiple tabs within a single browser editor page, shown on the left panel
2. **persephone tabs** — Multiple browser editor pages as separate persephone tabs
3. **persephone windows** — Browser editor pages across separate application windows

### Tab Reordering

Internal browser tabs support drag-and-drop reordering via `react-dnd`. Each tab in `BrowserTabsPanel` uses `useDrag`/`useDrop` hooks (drag type: `BROWSER_TAB_DRAG`). On drop, `BrowserEditorModel.moveTab(fromId, toId)` splices the tab from its source position and inserts it at the target position. Since webviews are rendered through `PageManager` with stable DOM placeholders, reordering the `state.tabs` array doesn't cause webview reloads.

### New Window Handling

| Source | Disposition | Behavior |
|--------|------------|----------|
| `target="_blank"` link click | `foreground-tab` / `background-tab` | Opens as new internal tab in same browser page |
| `window.open()` from JavaScript | `default` / `new-window` | Opens as real popup BrowserWindow |

The main process intercepts these via `setWindowOpenHandler()` on the webContents. **Link clicks** (`target="_blank"`) are denied and relayed to the renderer as a `"new-window"` event, which calls `model.addTab(url)`. **JavaScript `window.open()` calls** (OAuth popups, login dialogs, etc.) are allowed as real Electron BrowserWindows — this preserves the `window.opener` reference that auth flows need to communicate back to the parent page. The popup inherits the webview's session partition, so cookies and auth state are shared.

**Important:** The `<webview>` element requires `allowpopups="true"` for `setWindowOpenHandler` to fire on `target="_blank"` link clicks.

### Popup/Tab Rate Limiting

Both code paths (internal tabs and real popup windows) are protected by a **global app-wide rate limiter** (`globalPopupRateLimiter` from `src/ipc/popup-rate-limiter.ts`) — max 3 requests within 2 seconds across the entire application. This prevents cascade attacks where each new tab opens more tabs. When exceeded:

- **Internal tabs** (renderer): blocked in `BrowserWebviewModel.handleBrowserEvent("new-window")`; increments `blockedPopupCount` in state
- **Popup windows** (main process): blocked in `setWindowOpenHandler`; sends `"popups-blocked"` IPC event to renderer

Each process (main, renderer) imports the same `globalPopupRateLimiter` singleton but gets its own instance — this is fine because they guard different things (renderer: internal tabs via `"tabs"` key, main: popup BrowserWindows via `"popups"` key).

A notification bar appears below the loading indicator showing the blocked count. The user can click "Allow" to permanently whitelist popups for the session (allows both renderer and main process rate limiters via `BrowserChannel.allowPopups` IPC), or dismiss the bar.

## Process Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Guest Page (webview)          │  Renderer Process    │  Main Process│
│  (isolated Chromium context)   │  (React UI)          │  (Node.js)   │
├────────────────────────────────┼──────────────────────┼──────────────┤
│  preload-webview.ts            │  BrowserEditorView.tsx │  browser-    │
│  - MutationObserver on <head>  │  BrowserEditorModel.ts │  service.ts  │
│  - Detects title/favicon       │  BrowserTabsPanel.tsx│  - Attaches  │
│  - sendToHost() messages       │  - Toolbar, URL bar  │    to real   │
│                                │  - Multi-webview     │    webContents│
│                                │  - Tabs panel        │  - Relays    │
│                                │  - State management  │    events    │
└────────────────────────────────┴──────────────────────┴──────────────┘
```

## Multi-Webview Rendering

Each internal tab has its own `<webview>` element. All webviews are rendered in the DOM simultaneously, but only the active tab's webview is visible (`display` vs `display: none`). This preserves each tab's state (scroll position, form data, session) without re-navigation on tab switch.

### PageManager (Portal-Based DOM Stability)

Webview elements are rendered through a `PageManager` component (`src/renderer/components/page-manager/PageManager.tsx`) that uses React portals with imperatively managed placeholder divs. This prevents `<webview>` elements from being destroyed and recreated when the tab array changes (tabs closed, reordered).

Without PageManager, React's list reconciliation would detach and reinsert DOM nodes when array positions shift — even with stable keys. Reinserted `<webview>` elements are treated as new by the browser and reload, losing user data.

**How it works:**
1. For each tab ID, a stable placeholder `<div>` is created via `document.createElement()` and appended to a container
2. React content (the `BrowserWebviewItem`) is rendered into each placeholder via `createPortal()`
3. When a tab is closed, only its placeholder is removed with `removeChild()` — siblings are untouched
4. Visibility is controlled via `display: none` on inactive placeholders

The `BlankPageLinks` component (bookmarks on empty tabs) is also rendered inside the portal per-tab, so its scroll position is preserved across tab switches.

### dom-ready Gating

A `webviewReady` ref (a `Set<string>` of internal tab IDs) tracks which webviews have fired `dom-ready`. The navigation effect checks this before calling `webview.loadURL()`. Without this, calling `loadURL()` on a newly created webview before it's attached to the DOM crashes the app.

### IPC Registration

Each webview registers with the main process using a composite key: `${tabId}/${internalTabId}`. This supports multiple internal tabs per persephone page tab. Registration happens on `dom-ready`, and cleanup happens on component unmount.

**Important:** The IPC registration effect must NOT include `tab.url` in its dependency array. If it does, the effect cleanup runs on every URL change, which clears the `webviewReady` state and breaks navigation.

## Data Flow

### 1. User navigates (types URL + Enter)

```
BrowserEditorView → model.navigate(url) → state.url + active tab.url updated
    → Navigation effect detects URL change
    → Checks webviewReady before calling loadURL()
    → webview loads the page
```

### 2. Navigation events (page loaded, redirected)

```
webContents events (main)          IPC                    Renderer
─────────────────────────    ───────────────    ─────────────────────
did-navigate (url)       →  BrowserChannel  →  onBrowserEvent handler
                             .event              → model.currentUrl = url
                                                 → setUrlInput(url)
                                                 → model.updateFromWebview(...)
```

**CRITICAL:** Navigation events update `model.currentUrl` and `setUrlInput()` directly. They do **NOT** update `state.url`. If you update `state.url` from a navigation event, React will re-render `<webview src>` with the new URL, causing the webview's `attributeChangedCallback` to trigger a redundant navigation → ERR_ABORTED.

The rule: `state.url` = navigation target (set by user action only). `model.currentUrl` = actual current URL in webview.

### 3. Title and favicon detection (preload script)

```
Guest Page DOM                  Preload                  Renderer
───────────────         ────────────────────     ─────────────────────
<title> changes     →   MutationObserver     →   ipc-message event
<link rel="icon">   →   reportTitle/Favicon  →   onIpcMessage handler
changes                 sendToHost(channel)       → model.updateFromWebview(...)
                                                  → model.cacheFavicon(...)
```

### 4. Loading state

```
Main process                    IPC                    Renderer
─────────────               ──────────         ─────────────────────
did-start-loading       →   browser:event  →   model.updateFromWebview({ loading: true })
did-stop-loading        →   browser:event  →   model.updateFromWebview({ loading: false })
```

### 5. Protocol blocking

```
Main process                    IPC                    Renderer
─────────────               ──────────         ─────────────────────
did-start-navigation    →   Check protocol →   If blocked: wc.stop()
(file:, app-asset:)         BLOCKED_PROTOCOLS   → send blocked event
                                                → webview.goBack()
```

## Context Menu

The webview's right-click context menu is intercepted in the main process and relayed to the renderer for display as the app's popup menu.

### Flow

```
Main Process                          IPC                       Renderer
─────────────                    ──────────────          ────────────────────────
webContents                      BrowserChannel          BrowserEditorView
  context-menu event         →     .event            →     onBrowserEvent handler
  event.preventDefault()           type: "context-menu"     → SVG probe (elementFromPoint)
  params: linkURL, srcURL,         data: x, y, linkURL,    → Build MenuItem[] based on context
    selectionText, isEditable,       srcURL, selectionText, → showAppPopupMenu(x, y, items)
    editFlags, x, y                  isEditable, editFlags
```

### Context-Sensitive Items

The renderer builds the menu dynamically based on `params` fields from the `context-menu` event:

| Condition | Menu Items |
|-----------|------------|
| `linkURL` present | Open Link in New Tab, Copy Link Address |
| `srcURL` + `mediaType === "image"` | Open Image in New Tab, Copy Image Address |
| `selectionText` present | Copy (uses `navigator.clipboard.writeText`) |
| `isEditable` | Cut, Copy, Paste (uses `webview.cut/copy/paste()` with `webview.focus()`) |
| SVG probe finds `<svg>` ancestor | Open SVG in Editor |
| Always | Back, Forward, Reload, View Source, View Actual DOM, Show Resources, Inspect Element |

### Key Implementation Details

- **Coordinates:** `params.x/y` are in host window coordinate space (used for popup position). For `webview.inspectElement()` and `elementFromPoint()`, subtract the webview's bounding rect to get webview-relative coordinates.
- **SVG extraction:** Uses `webview.executeJavaScript()` to probe the click target with `elementFromPoint()` + `closest('svg')`. The SVG is cloned and auto-fixed (xmlns, viewBox from `getBBox()`, width/height, HTML comment stripping).
- **Copy for selections:** Uses `navigator.clipboard.writeText(selectionText)` instead of `webview.copy()` because the webview loses focus when the popup menu opens.
- **Popup dismissal:** Webview clicks don't bubble to the renderer DOM. A transparent overlay (`webview-click-overlay`) is rendered over the webview area while a popup menu is open, allowing clicks to reach the renderer's `document` and trigger the popup's dismiss handler.
- **skipInspect:** The browser context menu provides its own "Inspect Element" item, so `showAppPopupMenu` is called with `{ skipInspect: true }` to suppress the app's default "Inspect" item.

## Key Files

| File | Process | Purpose |
|------|---------|---------|
| `src/renderer/editors/browser/BrowserEditorView.tsx` | Renderer | UI component: toolbar, URL bar, multi-webview management, URL suggestions, bookmarks |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Renderer | Multi-tab state management, navigation logic, favicon caching, search engines |
| `src/renderer/editors/browser/BrowserTabsPanel.tsx` | Renderer | Left-side internal tabs panel with compact extension popup, drag-to-reorder |
| `src/renderer/editors/browser/BrowserBookmarks.ts` | Renderer | Wraps TextFileModel + LinkEditorModel for bookmark file I/O |
| `src/renderer/editors/browser/BookmarksDrawer.tsx` | Renderer | Sliding overlay drawer rendering the Link Editor for bookmarks |
| `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx` | Renderer | URL bar dropdown with search history and navigation history |
| `src/renderer/editors/browser/browser-search-history.ts` | Renderer | Per-profile persistent search history storage (file-based) |
| `src/renderer/editors/browser/TorStatusOverlay.tsx` | Renderer | Tor connection overlay with spinner, log, reconnect button |
| `src/main/browser-service.ts` | Main | Attaches to webContents, relays events via IPC, audio state, hotkeys, cache cleanup |
| `src/main/tor-service.ts` | Main | Tor process lifecycle: spawn/kill tor.exe, per-partition SOCKS5 proxy, torrc generation |
| `src/preload-webview.ts` | Guest | MutationObserver for title/favicon, image tracking on link clicks |
| `src/ipc/browser-ipc.ts` | Shared | IPC channel names and type definitions |
| `src/ipc/tor-ipc.ts` | Shared | Tor IPC channels: start, stop, log |
| `src/ipc/popup-rate-limiter.ts` | Shared | Time-window rate limiter for popup/tab spam blocking |
| `src/renderer/editors/shared/link-open-menu.tsx` | Renderer | Shared helper for "Open in..." browser menu items |
| `src/renderer/core/state/events.ts` | Renderer | `globalKeyDown` Subscription for keyboard event broadcasting, `browserUrlChanged` for cross-editor URL event broadcasting, `windowClosing` for resource cleanup on window close, `pageNavigatorToggled` for sidebar open/close, `panelExpanded` for secondary panel expansion |

## Why the Main Process Bridge?

The `<webview>` DOM element's event API is unreliable — events like `page-favicon-updated` don't fire consistently on back/forward navigation. The main process has direct access to the real `webContents` object, where these events fire reliably. The bridge:

1. Renderer registers webview via `BrowserChannel.register` (sends `webContentsId`, `tabId`, `internalTabId`)
2. Main process calls `webContents.fromId(id)` to get the real object
3. Main process attaches native event listeners
4. Events are relayed back via `BrowserChannel.event` with `internalTabId` for routing
5. Main process also sets `windowOpenHandler` to intercept new-window requests

## Why the Preload Script?

The main process `page-favicon-updated` event works for most cases, but the preload script provides a complementary detection mechanism using DOM observation. It:

- Uses `MutationObserver` on `<head>` to detect `<link rel="icon">` and `<title>` changes
- Runs in an isolated JavaScript context (context isolation) — page scripts cannot interfere
- Sends messages via `ipcRenderer.sendToHost()` → received as `ipc-message` events on the `<webview>` element
- Retries after page `load` event (200ms + 1000ms) for JS-heavy sites that set metadata late

## Favicon Handling

Favicons use a caching strategy to avoid showing the globe icon during same-origin navigations:

1. When a favicon is received (from preload), it's cached by origin: `model.cacheFavicon(url, favicon)`
2. On `did-navigate`, the cached favicon for the new URL's origin is applied immediately
3. The preload script then fires with the actual favicon, updating if different

The `getIcon()` method on `BrowserEditorModel` reads `this.state.get().favicon` synchronously. `PageTab` subscribes to favicon changes via `_iconHint` in its state selector to trigger re-renders.

## Build Configuration

The webview preload script is a separate Vite build entry in `forge.config.ts`:

```typescript
{
    entry: "src/preload-webview.ts",
    config: "vite.preload-webview.config.ts",
    target: "preload",
}
```

The main preload (`src/preload.ts`) exposes the path to the webview preload:

```typescript
(window as any).webviewPreloadUrl = pathToFileURL(
    path.join(__dirname, "preload-webview.js"),
).toString();
```

## Session Restore

`getRestoreData()` saves all internal tabs with their actual current URLs (from `currentUrls` map, which tracks post-redirect URLs). `applyRestoreData()` restores them with fresh internal tab IDs (since IDs are ephemeral). The active tab is identified by index position during restore. Profile name, incognito flag, and Tor flag are also saved/restored.

Navigation history (`navHistory` on each `BrowserTabData`) is persisted as part of the tab state via `getRestoreData()`. Search history is stored separately per profile in the app data folder using `SearchHistoryStorage` (file-based, max 2000 entries). Incognito and Tor profiles skip search history persistence.

Tor pages are restored with a fresh empty tab (no URLs from previous session) and `torStatus: "disconnected"`. The Tor overlay is shown with a "Reconnect" button — the user must explicitly reconnect.

## Profiles & Incognito

Each browser page is bound to a **profile** that determines its Electron session partition. All internal tabs within the same browser page share the same profile.

### Partition Mapping

| Mode | Partition String | Persistence |
|------|-----------------|-------------|
| Default profile | `persist:browser-default` | Persists across restarts |
| Named profile "work" | `persist:browser-work` | Persists across restarts |
| Incognito | `browser-incognito-<uuid>` | Cleared when page closes |
| Tor | `browser-tor-<uuid>` | Cleared when page closes |

`getPartitionString()` in `BrowserEditorModel.ts` computes the partition. `BrowserEditorModel.partition` is a **getter** (not a stored field) because the profile state may be set after model construction in `showBrowserPage()`. Each incognito/tor model has a stable `incognitoId`/`torId` (random UUID generated once per instance) to keep the partition consistent across getter calls.

### Profile Settings

Profiles are stored in app settings as `BrowserProfile[]` (`{ name, color }`). A separate `browser-default-profile` setting tracks which profile the "Browser" quick-add menu item uses. Colors come from the `TAG_COLORS` palette in `palette-colors.ts`, and the built-in default uses `DEFAULT_BROWSER_COLOR` (cyan `#4DD0E1`).

### Page Tab Icons

| Mode | Icon |
|------|------|
| Default profile (no name) | GlobeIcon tinted with `DEFAULT_BROWSER_COLOR` or default profile's color |
| Named profile | GlobeIcon tinted with the profile's color |
| Incognito | IncognitoIcon |
| Tor | TorIcon (purple onion, branded colors) |

The `resolvedColor` getter on `BrowserEditorModel` resolves the color chain: explicit profile → default profile setting → `DEFAULT_BROWSER_COLOR`.

### Incognito Indicator

Incognito pages show an `IncognitoIcon` inside the URL bar's left edge, using the `startButtons` prop on `TextField`.

### Tor Mode

Tor mode routes all webview traffic through the Tor network via a SOCKS5 proxy. Like incognito, Tor partitions are ephemeral (no `persist:` prefix). The Tor process is managed lazily — started on first Tor page open, stopped when the last Tor page closes.

**Architecture:**
- `src/main/tor-service.ts` — manages `tor.exe` child process lifecycle, generates minimal torrc, sets `socks5://` proxy per partition via `session.fromPartition().setProxy()`
- `src/ipc/tor-ipc.ts` — IPC channels: `tor:start`, `tor:stop`, `tor:log`
- `src/renderer/editors/browser/TorStatusOverlay.tsx` — overlay shown during connection with live log, spinner, and reconnect button
- `activePartitions: Set<string>` acts as consumer counter — Tor stops only when all partitions are released

**Tor indicator in URL bar:** A clickable TorIcon with a small status dot (green=connected, red=error, yellow=disconnected). Clicking toggles the `TorStatusOverlay`.

**Session restore:** Tor pages are restored with `torStatus: "disconnected"`, `torOverlayVisible: true`, and an empty tab. User must click "Reconnect" — no auto-connect on restore.

**Window close cleanup:** `BrowserEditorModel` subscribes to the `windowClosing` event (from `GlobalEventService.beforeunload`) to release Tor partitions when the window closes without explicit tab disposal.

### Clear Profile Data

The renderer can clear all browsing data for a partition via `ipcRenderer.invoke(BrowserChannel.clearProfileData, partition)`. The main process handler calls `session.fromPartition(partition).clearStorageData()` + `clearCache()`. This is used in two places:
- "Clear data" button on each profile row in Settings
- Profile deletion (confirmation dialog, then clear + remove from settings)

### Automatic Cache Cleanup on Page Close

When a browser page is closed (disposed), its HTTP cache, V8 code cache, and service worker caches are automatically cleared via `BrowserChannel.clearCache`. This prevents Chromium's disk caches from growing indefinitely. Cookies, localStorage, IndexedDB, and sessionStorage are preserved — users stay logged in.

The `clearCache` IPC handler runs three operations in parallel:
- `session.clearCache()` — HTTP disk cache (scripts, images, stylesheets)
- `session.clearCodeCaches({})` — V8 compiled bytecode cache
- `session.clearStorageData({ storages: ["serviceworkers", "cachestorage"] })` — service worker scripts and CacheStorage

Skipped for incognito and Tor pages since they use non-persistent partitions (no `persist:` prefix = memory-only).

**Disposal lifecycle:** `page.dispose()` is called from the `onClose` callback in `PagesModel.ts`, which fires when the user closes a tab. The `movePageOut` flow (tab transfer to another window) calls `detachPage()` first, which clears `onClose`, preventing disposal of transferred pages.

## Link Integration

External links clicked in Monaco or Markdown editors are routed through an IPC event (`eOpenUrl`) from the main process to the renderer. The renderer checks the `link-open-behavior` app setting:

- `"default-browser"` (default): Opens the URL via `shell.openExternal()`
- `"internal-browser"`: Opens the URL in the nearest browser tab via `openUrlInBrowserTab()`

### Link Routing Flow

```
Main Process                    IPC                    Renderer
─────────────               ──────────         ─────────────────────
will-navigate (http url)   →  eOpenUrl(url)  →  Check appSettings
setWindowOpenHandler(url)  →  eOpenUrl(url)  →    → "default-browser": shell.openExternal(url)
                                                  → "internal-browser": openUrlInBrowserTab(url)
```

### Smart Browser Tab Search (`openUrlInBrowserTab`)

Located in `src/renderer/api/pages/PagesLifecycleModel.ts`. Two search strategies depending on the source:

**Internal links** (Monaco, Markdown — `link-open-behavior: "internal-browser"`):
1. Search pages to the **right** of the active page for a matching browser tab
2. If not found, search pages to the **left**
3. If still not found: create a new Browser page (using the default profile) as the last tab

**External links** (IPC from main process via `eOpenExternalUrl`, e.g. default browser registration):
1. **Prefer the active page** if it's already a matching browser tab
2. If not, search **all pages** (left to right) for a matching browser tab
3. If still not found: create a new Browser page (using the default profile) as the last tab

For existing browser tabs: if the tab has only one empty (`about:blank`) internal tab, `navigate(url)` reuses it; otherwise `addTab(url)` creates a new internal tab.

### Markdown Link Context Menu

Right-clicking a link in Markdown Preview (or Notebook embedded Markdown) shows additional items for external URLs (http/https) via the shared `appendLinkOpenMenuItems()` helper:
- "Open in Default Browser" — `shell.openExternal(href)`
- "Open in Internal Browser" — `openUrlInBrowserTab(href)`
- Per-profile items — `openUrlInBrowserTab(href, { profileName })` for each configured browser profile
- "Open in Incognito" — `openUrlInBrowserTab(href, { incognito: true })`

### Exceptions

- **About page links** always open in the OS default browser (direct `shell.openExternal()` call, bypasses IPC routing)
- **HTML Preview** blocks all link navigation (unchanged)
- **Browser Editor** has its own link handling (new internal tabs, context menu) — not affected

## Bookmarks

Each browser profile can be associated with a `.link.json` bookmarks file. Bookmarks are lazily initialized on first user action (star button or "Open Links") and reused for the lifetime of the browser page.

### Architecture

```
BrowserBookmarks (stored on BrowserEditorModel.bookmarks)
    ├─ TextFileModel     — file I/O, encryption, FileWatcher, auto-save
    └─ LinkEditorModel   — parsed link data, categories, tags, filters
```

`BrowserBookmarks` wraps both models. `TextFileModel` handles reading/writing the `.link.json` file (including encryption/decryption), while `LinkEditorModel` provides the structured data layer. Every mutation flows through `LinkEditorModel.onDataChanged()` → `TextFileModel.changeContent()` → debounced save to disk.

### Initialization Flow

Bookmarks load through two paths:

**Eager preload (silent):** On browser page creation, `preloadBookmarks()` runs after a 300ms delay. It checks for a configured bookmarks file, calls `BrowserBookmarks.init({ silent: true })` which skips the password dialog for encrypted files. If successful, bookmarks appear immediately on blank tabs. If encrypted, bookmarks stay null until the user triggers manually.

**Manual trigger (interactive):** User clicks ☆ (star) or "Open Links" → check `model.bookmarks !== null` → if null, read profile's bookmarks file path from settings → if no file path, show "Associate Bookmarks File" dialog → create `BrowserBookmarks(filePath)` → `init()` with password dialog if encrypted → store on `BrowserEditorModel.bookmarks`.

After initialization, `BrowserEditorModel` sets two callbacks on `linkModel`:
- `onInternalLinkOpen` — routes link clicks to the correct browser page (navigates current blank tab, or adds new tab if current tab has content). `Ctrl+Click` always opens in a new tab (detected via `window.event.ctrlKey` in the callback).
- `onGetLinkMenuItems` — returns an "Open in New Tab" menu item that calls `model.addTab(url)`. These items are prepended to the link context menu (before "Edit"), providing mouse-only access to new-tab behavior without requiring `Ctrl+Click`.

### Three Entry Points

- **Blank page overlay** — when a tab shows `about:blank` and bookmarks are loaded (not encrypted), the `BlankPageLinks` component renders the Link Editor over the empty webview. Has its own toolbar (with breadcrumb, view mode, search). Disappears when user navigates to a URL.
- **Star button (☆)** in the URL bar — quick bookmark add/edit. Empty star when URL not bookmarked, filled star when bookmarked. Opens Edit Link Dialog with URL/title prefilled and discovered images.
- **"Open Links" button** on the toolbar — opens the `BookmarksDrawer`, a right-anchored overlay with the full Link Editor. Link clicks navigate to the URL (in current tab if `about:blank`, otherwise new internal tab) and close the drawer.

### Image Discovery

Images for bookmarks are collected from multiple sources:

1. **Meta tags** — `og:image`, `twitter:image`, `meta[name="thumbnail"]` extracted via `executeJavaScript` on the webview
2. **Click tracking** — the preload script captures all `<img>` URLs inside clicked `<a>` elements and sends them via `ipcRenderer.sendToHost("clicked-images", urls)`
3. **Per-tab image tracking** — `trackedImagesRef` stores discovered images per internal tab with navigation levels (level 0 = current page, level 1 = previous page, level 2 = two pages back; levels > 2 are dropped)
4. **Context menu** — "Use Image for Bookmark" pushes an image URL to level 0; "Add to Bookmarks" captures href, imgSrc, and title from the right-clicked element

All discovered images are merged (deduplicated) and passed to the Edit Link Dialog.

### BookmarksDrawer

A right-anchored overlay that renders the Link Editor with a `swapLayout` prop (Categories/Tags panel on the right). Key behaviors:

- Initial width = 60% of browser page, max 90%, resizable via Splitter
- Width persisted in component state
- Portal refs passed via `LinkEditorProps` (`toolbarRefFirst`, `toolbarRefLast`, `footerRefLast`) — each consumer provides its own portal targets so multiple LinkEditor instances don't conflict
- Closes on Escape, backdrop click, or link click navigation

### Portal Refs Pattern

The Link Editor uses React portals for toolbar and footer content. To support multiple simultaneous instances (blank page overlay + BookmarksDrawer), portal target refs are passed via `LinkEditorProps` instead of being stored on the shared TextFileModel. When props are omitted, the editor falls back to model refs (backward compatible with standalone link editor pages). Each consumer (BlankPageLinks, BookmarksDrawer) creates its own placeholder divs and passes them as props.

### Encrypted Bookmarks

If the `.link.json` file is encrypted, `BrowserBookmarks.init()` detects this via `isEncrypted(content)` and calls `showPasswordDialog({ mode: "decrypt" })`. This is the same async password dialog used by the text editor's encryption feature. If the user cancels, `init()` returns `false` and the bookmarks are not loaded. The `silent: true` option skips the dialog entirely (used by eager preload).

## Keyboard Shortcuts

Browser hotkeys (F5, F12, Alt+Left/Right, etc.) must work regardless of where focus is — inside the webview, on the toolbar, or elsewhere. This requires a three-layer approach:

### Layer 1: Main Process (`before-input-event`)

When focus is inside a `<webview>`, keyboard events are consumed by the guest page and never reach the renderer's DOM. The main process intercepts these via `webContents.on("before-input-event")` in `browser-service.ts`, handling F5, Ctrl+R, F12, Escape, and Alt+Left/Right directly on the webContents.

### Layer 2: Global Key Event Bus (`globalKeyDown` Subscription)

When focus is on any renderer element (toolbar, URL bar, tab panel, or no specific focus), the browser editor subscribes to a global keyboard event bus. `MainPage` broadcasts all `keydown` events via `globalKeyDown.send(e)` (defined in `events.ts`). `BrowserEditorModel` subscribes in its constructor and handles browser hotkeys only when it's the active page. This keeps browser-specific logic out of MainPage.

### Layer 3: Root div `onKeyDown` (`BrowserWebviewModel`)

The root browser `<div>` handles `Ctrl+L` (focus URL bar) and `Ctrl+F` (find in page) — shortcuts specific to the browser UI that don't need global reach.

### Supported Hotkeys

| Shortcut | Action | Layers |
|----------|--------|--------|
| `F5` | Reload | Main process + global |
| `Ctrl+F5` / `Ctrl+Shift+R` | Hard reload | Main process + global |
| `Ctrl+R` | Reload | Main process + global |
| `F12` | Open DevTools | Main process + global |
| `Alt+Left` / `Alt+Right` | Back / Forward | Main process + global |
| `Alt+Home` | Go to home page | Global only |
| `Escape` | Stop loading | Main process + global |
| `Ctrl+L` | Focus URL bar | Root div only |
| `Ctrl+F` | Find in page | Root div only |

## Scripting Facade

Scripts access browser pages via `page.asBrowser()`, which returns a `BrowserEditorFacade`. Unlike content-view facades (which acquire a ViewModel with ref-counting), this wraps `BrowserEditorModel` directly — no ViewModel, no ref-counting — because the browser is a standalone, not a content-view.

```javascript
const browser = await page.asBrowser();
browser.navigate("https://example.com");
console.log(browser.url);    // "https://example.com"
console.log(browser.title);  // "Example Domain"
browser.back();
browser.forward();
browser.reload();
```

**Interface:** [`IBrowserEditor`](../../src/renderer/api/types/browser-editor.d.ts) — `url`, `title`, `navigate()`, `back()`, `forward()`, `reload()`
**Implementation:** [`BrowserEditorFacade`](../../src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts)

## Link Open Menu Helper

`appendLinkOpenMenuItems()` in `src/renderer/editors/shared/link-open-menu.tsx` is a reusable function that appends "Open in..." browser menu items to a `MenuItem[]` array. It generates items for: OS default browser, internal browser, all configured user profiles, and incognito. Used by Link Editor (list, tiles, pinned links) and Markdown Preview link context menus.

Additionally, `LinkViewModel.onGetLinkMenuItems` is an optional callback that allows the host (e.g., browser editor) to inject custom menu items at the top of the link context menu. Items returned by this callback are prepended before the "Edit" item with a separator.

## Common Pitfalls

1. **Never update `state.url` from navigation events.** Only update it from user-initiated `model.navigate()`. Use `model.currentUrls` map for tracking the actual URL per internal tab.

2. **The webview's `src` attribute is set once at creation.** The initial URL is captured in a ref. Subsequent navigations use `webview.loadURL()` from a React effect, gated by `webviewReady`.

3. **Never include `tab.url` in the IPC registration effect dependencies.** This causes the effect to re-run on every navigation, clearing `webviewReady` and breaking subsequent navigations.

4. **Call `loadURL()` only after dom-ready.** New tabs created via `addTab(url)` must wait for the webview to fire `dom-ready` before `loadURL()` is called. The `webviewReady` Set tracks this.

5. **Favicon requires PageTab subscription.** `PageTab` must include favicon in its state selector (via `_iconHint`) or it won't re-render when the favicon changes.

6. **The preload script runs in an isolated context.** It shares the DOM with the page but not JavaScript objects. Page scripts cannot access or interfere with the preload's `ipcRenderer` or `MutationObserver`.

7. **Registration/unregistration lifecycle.** The webview registers with the main process on `dom-ready` (when `getWebContentsId()` is available) and unregisters on cleanup. The main process also cleans up if the webContents or sender is destroyed.

8. **Webview background color.** Sites that don't set an explicit background rely on the browser default (white). The webview uses dynamic background: `color.background.default` for blank/new tabs (matching the app theme), switching to `#ffffff` once the user navigates to a real page.

9. **Emotion `&` selector in nested rules.** In Emotion's object syntax, `&` always resolves to the root styled component's class. Inside nested selectors like `"& .tab-close"`, a child rule `".tab-item:hover &"` would generate `.tab-item:hover .ROOT` — not `.tab-item:hover .tab-close`. Always define hover-reveal rules at the parent level: `"& .tab-item": { "&:hover .tab-close": { opacity: 1 } }`.

10. **DRM / Widevine CDM.** The app uses [Castlabs Electron (ECS)](https://github.com/castlabs/electron-releases) — a fork with Widevine DRM support. At startup, `components.whenReady()` in `main-setup.ts` ensures the CDM is downloaded. Production builds require VMP signing via Castlabs EVS (`scripts/vmp-sign.mjs`). Without VMP signing, DRM works on test pages but not on Netflix/Disney+.
