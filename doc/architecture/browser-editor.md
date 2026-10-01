# Browser Editor Architecture

> Read this before modifying or extending the browser editor.

## Overview

The browser editor embeds Chromium `<webview>` elements inside a tab, providing an in-app web browser with **multi-tab support**. Each browser page (persephone tab) contains its own set of internal browser tabs, displayed in a left-side panel. Unlike other editors that live entirely in the renderer process, the browser editor spans **three process boundaries** with IPC bridges between each.

## Tab Architecture

The browser editor uses three levels of tab nesting:

1. **Internal browser tabs** — Multiple tabs within a single browser editor page, shown on the left panel
2. **persephone tabs** — Multiple browser editor pages as separate persephone tabs
3. **persephone windows** — Browser editor pages across separate application windows

### Model Composition

`BrowserEditor` is the coordinator for the browser page. It owns editor-level
restore/persistence, profile presentation, navigation normalization, keyboard
shortcuts, and popup policy, while composing focused sub-models:

- `BrowserTabsModel` owns internal-tab lifecycle and tab-scoped resources:
  current URL and favicon caches, active-tab history, mute/panel operations, and
  the `BrowserBookmarks` resource.
- `BrowserTorModel` owns the per-instance partition identifiers, fail-closed
  proxy arming, Tor listeners/reconnect lifecycle, and window-close cleanup.
- `BrowserWebviewModel`, `BrowserUrlBarModel`, `BrowserBookmarksUIModel`, and
  `BrowserTargetModel` own webview events, URL-bar state, bookmark UI, and
  automation respectively.

The host keeps thin tab and Tor delegates for existing callers, but the
implementation and resource cleanup live in the relevant sub-model. Views read
tab-scoped data through `model.tabs` and the browser page still exposes the same
facade and IPC contracts.

### Browser toolbar order

`BrowserToolbarView` spells out its left-to-right DOM order in one append operation:
Home, Back, Forward, Reload, URL bar, Bookmarks, Tor info, Downloads, Page Menu, DevTools,
and Close Tab. The `controls` array may retain a different construction/index order because
`sync()` updates those views positionally; changing the visual order must not silently change
those indexes. The Tor-info control remains in the DOM when Tor is inactive but is hidden and
zero-sized, preserving the same layout contract in both modes.

### Tab Reordering

Internal browser tabs support drag-and-drop reordering through native HTML5 drag events and the shared trait system. Each tab in `BrowserTabsPanelView` carries the `BrowserTab` trait; on drop, `BrowserTabsModel.moveTab(fromId, toId)` splices the tab from its source position and inserts it at the target position. Since webviews are rendered through `PageManagerView` with stable native DOM placeholders, reordering the `state.tabs` array doesn't cause webview reloads. If a tab is dragged into a different group (see Tab Grouping below), it receives a new group ID.

### Tab Grouping

Each `BrowserTabData` has a `groupId` field (e.g. `bg-1`, `bg-2`). Tabs opened from the same parent share a group:

- **Manual actions** (plus button, bookmark click, typed URL) create a new group.
- **Link-opened tabs** (`target="_blank"`, "Open Link in New Tab" context menu) inherit the parent tab's `groupId` and are inserted after the active tab.

`BrowserTabsPanelView` visualizes groups with a 2px left border (via `::before`, separated from the
tab's own selection border). Groups alternate between two brightness levels based on the sequential
order of first appearance in the tab list (`groupColors`).

Group IDs are persisted in `getRestoreData()`. `applyRestoreData()` assigns fresh group IDs to restored tabs that lack one (backward compatibility).

The compact tab hover preview uses the native `PopoverView` and `@floating-ui/dom`. The former
React-only `@floating-ui/react` dependency is not part of the browser editor; `@floating-ui/dom`
remains the shared positioning dependency for eight UIKit consumers.

### Tab Activation History

`BrowserTabsModel` maintains a private `activeTabHistory` stack (array of tab IDs, most recent last). When `switchTab()` or `addTab()` changes the active tab, the previous active tab ID is pushed onto the stack. When `closeTab()` closes the active tab, it pops from the stack to find the most recent still-existing tab to activate, falling back to an adjacent tab if history is empty. The stack is cleaned up when tabs are closed (`closeTab`, `closeOtherTabs`, `closeTabsBelow`).

### Tab Creation and Focus

`BrowserEditor.addTab()` is the editor-level entry point for creating internal tabs. It delegates
tab state to `BrowserTabsModel`, then focuses the URL bar when the new tab is blank
(`about:blank`). The tabs panel's plus row uses this facade so a blank tab added to an existing
browser page receives the same URL-bar focus as the initial blank tab. Tabs opened with a URL keep
focus on the loading webview instead of stealing it for the URL bar.

### New Window Handling

| Source | Disposition | Behavior |
|--------|------------|----------|
| `target="_blank"` link click | `foreground-tab` / `background-tab` | Opens as new internal tab in same browser page |
| `window.open()` from JavaScript | `default` / `new-window` | Opens as real popup BrowserWindow |

The main process intercepts these via `setWindowOpenHandler()` on the webContents. **Link clicks** (`target="_blank"`) are denied and relayed to the renderer as a `"new-window"` event, which calls `model.addTab(url, parentGroupId)` (inheriting the parent tab's group). **JavaScript `window.open()` calls** (OAuth popups, login dialogs, etc.) are allowed as real Electron BrowserWindows — this preserves the `window.opener` reference that auth flows need to communicate back to the parent page. The popup inherits the webview's session partition, so cookies and auth state are shared.

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
│  (isolated Chromium context)   │  (native UI)         │  (Node.js)   │
├────────────────────────────────┼──────────────────────┼──────────────┤
│  preload-webview.ts            │  BrowserEditorView.ts   │  browser-    │
│  - MutationObserver on <head>  │  BrowserEditor.ts      │  service.ts  │
│  - Detects title/favicon       │  BrowserTabsPanel.ts │  - Attaches  │
│  - sendToHost() messages       │  - Toolbar, URL bar  │    to real   │
│                                │  - Multi-webview     │    webContents│
│                                │  - Tabs panel        │  - Relays    │
│                                │  - State management  │    events    │
└────────────────────────────────┴──────────────────────┴──────────────┘
```

## Multi-Webview Rendering

Each internal tab has its own `<webview>` element. All webviews are rendered in the DOM simultaneously, but only the active tab's webview is visible (`display` vs `display: none`). This preserves each tab's state (scroll position, form data, session) without re-navigation on tab switch.

### PageManagerView (Native Placeholder DOM Stability)

Webview elements are hosted by `PageManagerView` (`src/renderer/components/page-manager/`). The view owns imperatively-created placeholder divs, appends new placeholders with `appendChild`, and mounts one native `BrowserTabPageView` per tab. Each page view owns its `BrowserWebviewItemView` and its blank-page overlay, so no React island is needed for internal tabs. This prevents `<webview>` elements from being destroyed and recreated when the tab array changes (tabs closed, reordered).

Without PageManager, rebuilding the tab list would detach and reinsert DOM nodes when array positions shift. Reinserted `<webview>` elements are treated as new by the browser and reload, losing user data.

**How it works:**
1. For each tab ID, a stable placeholder `<div>` is created via `document.createElement()` and newly-created placeholders are appended to the manager root
2. A native `BrowserTabPageView` is mounted into each placeholder and owns the connected `BrowserWebviewItemView`
3. When a tab is closed, only its placeholder is removed with `removeChild()` — siblings are untouched
4. Visibility is controlled via `display: none` on inactive placeholders

The `BlankPageLinksView` overlay (bookmarks on empty tabs) is also owned by the per-tab native view, so its lifecycle is tied to that tab. Existing placeholders are never re-appended during tab reordering, so the `<webview>` element identity remains stable.

### Webview View Identity

`BrowserWebviewItemView` is a retained native child of `BrowserTabPageView`. The page view updates its tab projection imperatively while the `<webview>` element remains stable; navigation and per-event updates flow through `BrowserWebviewModel`. The blank-page overlay is an owned conditional child, released when the tab is no longer blank. This native identity boundary prevents browser state updates and tab-array reorderings from recreating guest renderer processes.

If you add a `tab` field that `BrowserWebviewItem` renders from, extend the memo comparator accordingly — otherwise the view goes stale.

`BrowserWebviewItem`'s mount effect also warns (`[browser] duplicate webview mount…`) when a webview mounts for a tab whose previous element is still connected to the DOM — a duplicate live mount leaks a whole guest renderer process. The warning exists to make that (rare, trigger unknown) condition self-identifying.

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
                             .event              → model.tabs.currentUrls = url
                                                 → setUrlInput(url)
                                                 → model.updateFromWebview(...)
```

**CRITICAL:** Navigation events update `model.tabs.currentUrls` and `setUrlInput()` directly. They do **NOT** update `state.url`. If you update `state.url` from a navigation event, the native view will treat the observed URL as a new navigation target and call `loadURL()` again, causing a redundant navigation → ERR_ABORTED.

The rule: `state.url` = navigation target (set by user action only). `model.tabs.currentUrls` = actual current URL in each webview.

### 3. Title and favicon detection (preload script)

```
Guest Page DOM                  Preload                  Renderer
───────────────         ────────────────────     ─────────────────────
<title> changes     →   MutationObserver     →   ipc-message event
<link rel="icon">   →   reportTitle/Favicon  →   onIpcMessage handler
changes                 sendToHost(channel)       → model.updateFromWebview(...)
                                                   → model.tabs.cacheFavicon(...)
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

**`BLOCKED_PROTOCOLS` is a navigation guard only.** It is checked on `did-start-navigation`, so
it stops a page from *navigating* to `file:` or `app-asset:` — it does not and cannot stop a
`fetch`, an `XMLHttpRequest`, a `<script src>`, or an `<iframe src>`.

Page-initiated URLs outside Chromium's navigation set are intercepted in the same
`will-navigate` handler and sent to the host renderer's `openRawLink` pipeline. This includes
registered board-contributed schemes, so a custom provider URL is opened by Persephone instead of
being handed to Chromium as an unsupported navigation.

What actually keeps `app-asset:` out of reach of web content is that **the protocol handler is
never registered on a browser page's session.** `registerAssetProtocol` (`src/main/main-setup.ts`)
installs it on the app partition and the file-access partition only, while browser pages run in
`persist:browser-*`, incognito, or Tor partitions — where the scheme simply has no handler and
every request fails. Boards are the deliberate exception: their frames live in the app session,
so board content *can* read `app-asset:`.

Keep both mechanisms in mind when changing either. Removing `app-asset:` from
`BLOCKED_PROTOCOLS` as "redundant" would re-open top-level navigation to it, and adding a
protocol to that list does **not** make it unreadable from page script.

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

`webview-context-menu.ts` builds the menu dynamically based on `params` fields from the `context-menu` event; `BrowserWebviewModel` supplies the webview and editor callbacks.

| Condition | Menu Items |
|-----------|------------|
| `linkURL` present | Open Link in New Tab, Copy Link Address |
| `srcURL` + `mediaType === "image"` | Open Image in New Tab, Copy Image Address |
| `selectionText` present | Copy (uses the renderer's Electron-native clipboard helper) |
| `isEditable` | Cut, Copy, Paste (uses `webview.cut/copy/paste()` with `webview.focus()`) |
| SVG probe finds `<svg>` ancestor | Open SVG in Editor |
| Always | Back, Forward, Reload, View Source, View Actual DOM, Show Resources, Inspect Element |

### Key Implementation Details

- **Coordinates:** `params.x/y` are in host window coordinate space (used for popup position). For `webview.inspectElement()` and `elementFromPoint()`, subtract the webview's bounding rect to get webview-relative coordinates.
- **SVG extraction:** Uses `webview.executeJavaScript()` to probe the click target with `elementFromPoint()` + `closest('svg')`. The SVG is cloned and auto-fixed (xmlns, viewBox from `getBBox()`, width/height, HTML comment stripping). The probe is bounded by `withTimeout(..., SVG_PROBE_TIMEOUT, null)` — see [Bounding page probes](#bounding-page-probes). On timeout the "Open SVG in Editor" item is dropped and the menu opens immediately; on idle pages the probe resolves near-instantly and the item is included.
- **"Add to Bookmarks" link info:** Probes the right-clicked `<a>` for a title and an `<img>` src, bounded the same way (`LINK_PROBE_TIMEOUT`, 1 s). The URL comes from the context-menu params rather than the page, so a timed-out probe costs only the suggested title and image.

### Bounding page probes

`webview.executeJavaScript()` queues on the **page's** renderer main thread, not ours. A page that is mid-load or busy can leave the call pending for as long as the load takes, and anything awaiting it stalls with it — a menu that never opens, a dialog that appears a minute later. Every probe whose result is a *suggestion* rather than a requirement is therefore bounded by `withTimeout(promise, ms, fallback)` (`core/utils/utils.ts`) and the UI proceeds with what the app already knows from its own state. `withTimeout` also maps a rejection to the fallback whether it arrives before or after the deadline, so an abandoned probe cannot resurface as an unhandled rejection.

The budget is per call site: a context-menu item that merely appears or disappears can afford 250 ms, while a dialog gathering image suggestions is given 1 s.
- **View Actual DOM / Show Resources:** Uses `ipcRenderer.invoke(BrowserChannel.collectDom, key)` to collect the full DOM from the main process. The main process iterates `webContents.mainFrame.framesInSubtree` to collect DOM from all frames (including cross-origin iframes), then uses cheerio to inject each iframe's DOM inside the corresponding `<iframe>` element in the parent HTML.
- **Copy for selections:** Uses the renderer's Electron-native clipboard helper instead of `webview.copy()` because the webview loses focus when the popup menu opens. Renderer-owned writes should use the native path for focus independence and compatibility with other history tools; see [Clipboard writes](../standards/coding-style.md#clipboard-writes). Native webview editing commands, including a page's own Ctrl+C, are still captured by the clipboard watcher: Chromium owns those writes through Electron's main-process pid, which the watcher trusts only for its `CanIncludeInClipboardHistory` marker. Its explicit `ExcludeClipboardContentFromMonitorProcessing` marker remains authoritative.
- **Popup dismissal:** Webview clicks don't bubble to the renderer DOM. A transparent overlay (`webview-click-overlay`) is rendered over the webview area while a popup menu is open, allowing clicks to reach the renderer's `document` and trigger the popup's dismiss handler.
- **skipInspect:** The browser context menu provides its own "Inspect Element" item, so `showAppPopupMenu` is called with `{ skipInspect: true }` to suppress the app's default "Inspect" item.

## Browser Panel Host

The browser editor mounts a native `SecondaryViewsView` inside both `BlankPageLinksView`
(empty-page bookmarks overlay) and `BookmarksDrawerView`. To do this without a `PageModel`,
`BrowserPanelHost` implements the `IPageHost` interface that `SecondaryViewsView` requires.

**Key design points:**
- `BrowserPanelHost` is **not** a `PageModel` — it has no tab identity or page lifecycle. It lives only for the lifetime of the browser editor that created it.
- `sidebarMandatory` is permanently `true`. The bookmarks panel can never be closed via the ✕ button or toggle.
- `mainEditorInstance` returns the bookmarks `LinkEditor`, so `linkEditor.isMain === true` — this satisfies `isMain`-gated features (e.g., showing save affordances).
- The optional main-editor-navigation members of `IPageHost` (`switchMainEditor`, `promoteSecondaryToMain`) are **omitted** — there is no main-editor navigation in the browser panel context.
- Sidebar width is persisted in the browser's own state by subscribing to `onWidthChange` — not in `openFiles0.json`.
- The host lives in `editors/browser/` (not `api/pages/`) to avoid an import cycle via `LinkEditor`.

`BrowserSecondaryViewsView` wires the native `SecondaryViewsView` to a `BrowserPanelHost`, passing
`views`, the host's `SecondaryViewsModel`, and stable `onActivatePanel` / `onResizeWidth`
commands. The child binds the model's width and active-panel fields directly. The bridge's host
subscription is only used to notice panel-list changes; it compares the ordered panel-editor model
identities because `panelEditors` returns a fresh array. Navigation changes no longer mirror into
the host's `state.version`. It is mounted in both `BlankPageLinksView` and `BookmarksDrawerView`.

## Key Files

| File | Process | Purpose |
|------|---------|---------|
| `src/renderer/editors/browser/BrowserView.ts` | Renderer | Native browser view composition: toolbar, URL bar, multi-webview hosting, and overlays |
| `src/renderer/editors/browser/BrowserEditor.ts` | Renderer | Editor coordinator: restore/persistence, navigation normalization, profile presentation, keyboard shortcuts, and composed sub-model lifecycle |
| `src/renderer/editors/browser/BrowserTabsModel.ts` | Renderer | Internal-tab lifecycle, current URL and favicon caches, mute/panel operations, and bookmark resource ownership |
| `src/renderer/editors/browser/BrowserTorModel.ts` | Renderer | Per-page Tor partition IDs, proxy arming, daemon listeners/reconnect, and cleanup |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Renderer | Webview refs, `browser:event` IPC handling including AiVision shape/notify signals, navigation updates, find-in-page, keyboard shortcuts |
| `src/renderer/editors/browser/webview-context-menu.ts` | Renderer | Browser webview context-menu construction and bounded DOM/SVG/resource probes |
| `src/renderer/editors/browser/BrowserTargetModel.ts` | Renderer | Automation adapter sub-model — implements `IBrowserTarget` for Object Model call paths |
| `src/renderer/editors/browser/BrowserTabsPanel.ts` | Renderer | Native left-side internal tabs panel with compact floating preview and drag-to-reorder |
| `src/renderer/editors/browser/BrowserBookmarks.ts` | Renderer | Wraps TextFileModel + LinkEditor for bookmark file I/O |
| `src/renderer/editors/browser/BookmarksDrawer.ts` | Renderer | Native sliding overlay drawer rendering the Link Editor for bookmarks |
| `src/renderer/editors/browser/BrowserPanelHost.ts` | Renderer | `IPageHost` implementation for the browser's bookmarks sidebar (non-page host) |
| `src/renderer/editors/browser/BrowserSecondaryViews.ts` | Renderer | Native `SecondaryViewsView` wiring for blank page and BookmarksDrawer |
| `src/renderer/editors/browser/UrlSuggestionsDropdown.ts` | Renderer | Native URL bar dropdown with search history and navigation history |
| `src/renderer/editors/browser/browser-search-history.ts` | Renderer | Per-profile persistent search history storage (file-based) |
| `src/renderer/editors/browser/TorStatusOverlay.ts` | Renderer | Native Tor connection overlay with spinner, log, reconnect button |
| `src/renderer/editors/browser/network-log-links.ts` | Renderer | Network log → ILink[] conversion for Show Resources |
| `src/renderer/automation/operations.ts` | Renderer | Shared target-neutral snapshot, navigation, locator/input, waiting, screenshot, network, and inner-tab operations |
| `src/renderer/automation/ref.ts` | Renderer | Host-scoped accessibility refs and iframe CDP-session maps |
| `src/renderer/automation/snapshot.ts` | Renderer | Accessibility tree → YAML formatter for automation snapshots |
| `src/renderer/automation/CdpSession.ts` | Renderer | CDP session wrapper (IPC to main process debugger) |
| `src/renderer/automation/AppTargetModel.ts` | Renderer | `IBrowserTarget` adapter for the app's own UI (`pageId: "app"`) |
| `src/renderer/api/window-screen.ts` | Renderer | Object Model adapter exposing the app-window target as `app.window.screen` |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts` | Renderer | Shared automation descriptor used by browser, board, and app-window hosts |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Renderer | `window.screen` descriptor, help, summary, and active-private-page restriction |
| `src/renderer/automation/types.ts` | Renderer | `IBrowserTarget` interface — what automation needs from browser editor |
| `src/main/browser-service.ts` | Main | Attaches to webContents, relays events via IPC, audio state, hotkeys, cache cleanup, DOM collection (incl. iframes) |
| `src/main/cdp-service.ts` | Main | CDP session management — debugger attach/detach/send via IPC, plus the browser-only AiVision binding and filtered runtime event path |
| `src/main/network-logger.ts` | Main | Per-page HTTP request/response logging via `session.webRequest`, circular buffer, IPC access |
| `src/main/tor-service.ts` | Main | Tor process lifecycle: spawn/kill tor.exe, restart, per-partition SOCKS5 proxy (armed before the daemon starts so the partition fails closed), torrc generation, exit-IP lookup |
| `src/main/tor-src-protocol.ts` | Main | `tor-src://` handler — fetches an `http(s)` URL through a Tor partition's session |
| `src/main/session-proxy.ts` | Main | Shared session proxy primitives (apply one proxy with no fallback, set direct, geo lookup) used by Tor and profile networks |
| `src/main/browser-network-service.ts` | Main | Profile/Incognito proxy state, `profile-src://` handler, guest WebRTC policy, egress check, `session-src` hand-off |
| `src/ipc/browser-network-ipc.ts` | Shared | `BrowserNetwork` type, endpoint validation, `browser-network:*` channels |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` | Renderer | Per-page profile network: apply before mount, follow settings edits, image route for app-drawn resources |
| `src/renderer/editors/link-editor/routed-src.ts` | Renderer | `ImageRoute` + `resolveRoutedSrc` — rewrites remote `src` values to `tor-src://` or `profile-src://` for a routed page |
| `src/renderer/ui/dialogs/TorInfoDialog.ts` | Renderer | Connection info for a routed page: Tor (exit IP, location, Reconnect) or proxy (egress IP, location) |
| `src/preload-webview.ts` | Guest | MutationObserver for title/favicon, image tracking on link clicks, cinema mode (expand `<video>` to full page), `window.chrome` compatibility shim |
| `src/ipc/browser-ipc.ts` | Shared | IPC channel names and type definitions |
| `src/ipc/tor-ipc.ts` | Shared | Tor IPC channels + `TorStatus`/`TorIpInfo` types: arm, start, stop, log, check-ip, restart, status |
| `src/ipc/popup-rate-limiter.ts` | Shared | Time-window rate limiter for popup/tab spam blocking |
| `src/renderer/editors/shared/link-open-menu.ts` | Renderer | Shared helper for "Open in..." browser menu items |
| `src/renderer/core/state/events.ts` | Renderer | `globalKeyDown` Subscription for keyboard event broadcasting, `browserUrlChanged` for cross-editor URL event broadcasting (including navigation-return claims), `windowClosing` for resource cleanup on window close, `secondaryViewsToggled` for sidebar open/close, `panelExpanded` for secondary panel expansion |

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

## Browser Compatibility Shim (`window.chrome`)

Some sites (notably Google sign-in) reject an embedded Chromium browser with *"This browser or app may not be secure"* when `window.chrome` is an empty object — genuine Chrome populates it with `loadTimes`, `csi`, and `app`, and the site evaluates it during initial page load. The preload defines a minimal, realistic `window.chrome` so the browser presents like the Chrome it actually is.

Because the site's own scripts read `window.chrome`, the shim must exist in the page's **main world at document-start**:

- The preload runs in an **isolated world** (context isolation stays on), so a plain `window.chrome = …` there is invisible to page scripts.
- A DOM `<script>` injection would reach the main world but is blocked by strict site CSPs (e.g. Google accounts).

The preload therefore uses `contextBridge.executeInMainWorld({ func })`, which runs the definition in the main world before the page's first script while keeping context isolation intact — no debugger and no CSP dependency. The shim is guarded so it never overrides a real Chrome `window.chrome`, and wrapped in `try/catch` to degrade to a no-op on Electron builds without the API.

## Cinema Mode (Preload)

The preload script injects a cinema mode feature — an expand/collapse button that appears on `<video>` elements when hovered, allowing the user to expand a video to fill the entire webview page.

**How it works:**

1. `initCinemaMode()` scans the page for `<video>` elements and sets up a `MutationObserver` to catch dynamically added elements.
2. `attachCinemaListeners()` registers `mouseenter`/`mouseleave` on each element's **parent container** (not the element itself — overlay divs often intercept events on the element).
3. On hover, `showCinemaBtn()` creates a `position: fixed` button (using DOM API, not `innerHTML` — pages with Trusted Types CSP block `innerHTML`) and appends it to `document.body`. The button repositions on `scroll` events.
4. On click, `enterCinema()`:
   - Saves each ancestor's `style.cssText`, then sets all ancestors to `position: fixed; 100vw × 100vh` — expanding the container chain without touching the target element itself (sites like YouTube continuously overwrite the video's inline styles)
   - Hides siblings of every ancestor via `visibility: hidden` (keeps the ancestor chain visible so the GPU compositor continues rendering video frames)
   - Appends a black backdrop div to `document.body`
   - Dispatches `window.resize` to trigger the site's resize handlers (e.g. YouTube recalculates video size from the new container dimensions)
   - For `<video>` elements: enables `video.controls = true` and watches with `MutationObserver` to restore it if the site removes the attribute
5. On collapse (button click or Escape), `exitCinema()` restores all saved styles and dispatches `window.resize` again.

**Key implementation constraints:**
- Button uses `document.createElementNS()` for SVG icons (not `innerHTML`) — required for pages with Trusted Types CSP (e.g. YouTube)
- Button is created on `mouseenter` and destroyed on `mouseleave` — sites like YouTube clean up unexpected persistent DOM children
- Never touches `<video>` inline styles directly — YouTube's JS overwrites them continuously; containers are resized instead
- `visibility: hidden` on siblings (not `display: none`) — keeps layout intact, preventing reflow that would confuse the site's JS

## Favicon Handling

Favicons use a caching strategy to avoid showing the globe icon during same-origin navigations:

1. When a favicon is received (from preload), it's cached by origin: `model.tabs.cacheFavicon(url, favicon)`
2. On `did-navigate`, the cached favicon for the new URL's origin is applied immediately
3. The preload script then fires with the actual favicon, updating if different

The `getIconElement()` method on `BrowserEditor` builds the current DOM glyph synchronously from the
browser mode and profile color. `PageTab` subscribes to favicon changes via `_iconHint` in its state
selector to trigger re-renders; the browser editor's own icon state is refreshed through its normal
model update path.

## Build Configuration

The webview preload script (`src/preload-webview.ts`) is built as its own bundle entry —
watch-built by `scripts/dev.mjs` in development and bundled by `scripts/build-prod.mjs` for
production (each declares it with an inline Vite config; there is no standalone
`vite.*.config.ts` file). It is emitted next to the main preload as `preload-webview.js`.

The main preload (`src/preload.ts`) exposes the path to the webview preload:

```typescript
(window as any).webviewPreloadUrl = pathToFileURL(
    path.join(__dirname, "preload-webview.js"),
).toString();
```

## Session Restore

`getRestoreData()` saves all internal tabs with their actual current URLs (from the `BrowserTabsModel.currentUrls` map, which tracks post-redirect URLs). `applyRestoreData()` restores them with fresh internal tab IDs and ensures each tab has a `groupId` (assigning a new one if missing for backward compatibility). The active tab is identified by index position during restore. Profile name, incognito flag, and Tor flag are also saved/restored.

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

`getPartitionString()` in `BrowserEditorModel.ts` computes the partition. `BrowserTorModel.partition` is a **getter** (not a stored field) because the profile state may be set after model construction in `showBrowserPage()`. Each incognito/Tor model has stable IDs (random UUIDs generated once per instance) to keep the partition consistent across getter calls.

### Permission Policy

`initPermissionPolicy()` runs during main-process setup before renderer or webview sessions are
created. The main process installs Electron permission-request and permission-check handlers on
each session, plus device-selection denial handlers. `permission-policy-service.ts` owns the
policy, pending request callbacks, and saved decisions; renderer code only presents prompts and
controls.

The service classifies sessions by their Electron `Session`, rather than trusting a renderer mode
flag. The app renderer session has a small built-in allowlist for app UI capabilities. The
file-access persistence session denies web permission requests. Browser sessions are identified
separately; persistent `persist:browser-<name>` sessions map to that named profile, while
non-persistent Incognito and Tor sessions have no profile name. Profile decisions are stored in
`browser-permissions.json` under the app data folder. Decisions for Incognito and Tor are held in
memory for the lifetime of their Electron session and are never written to disk.

For browser sessions, permission checks require a valid top-level HTTP(S) origin. They deny file
system, storage-access, HID, serial, USB, and deprecated synchronous clipboard-read checks;
media-key-system, fullscreen, pointer-lock, and sanitized clipboard-write checks are allowed.
Camera, microphone, and other supported site permissions check true only after an explicit saved
allow, while `openExternal` checks are false and unknown permissions default to false. Permission
requests apply their own handler rules: selected browser capabilities (including media-key-system,
fullscreen, pointer-lock, and sanitized clipboard writes) are accepted directly; storage-access,
top-level storage-access, and display-capture requests are denied; and supported undecided site
permissions prompt. The promptable set is camera, microphone, geolocation, notifications, MIDI,
clipboard read, idle detection, window management, speaker selection, and external URL schemes
`http`, `https`, `mailto`, and `tel`. Requests are attributed to the webContents' current top-level
HTTP(S) origin. An allow/block choice is remembered for that origin and permission; media requests
can cover camera and microphone together. Unknown requests and requests without a valid top-level
origin fail closed. Electron request and check callbacks are guarded so policy errors also fail
closed.

The main process accepts prompts only from registered browser webContents and relays them through
the owning app renderer's `BrowserChannel.event`. `BrowserWebviewModel` associates each prompt with
its internal tab, and `BrowserView` shows the permission bar for the active tab. Allow and Block
send only the opaque request ID and decision back over `BrowserChannel.resolvePermissionRequest`;
the main process owns the pending callback and stores the decision. Closing a webContents or
starting its main-frame navigation settles outstanding prompts as denied. The URL bar's site
permissions popover reads, changes, and resets decisions through main-process IPC keyed by the
registered webview. Main verifies that the caller owns that registration and derives the current
origin from the webContents. Profile Settings lists, removes, or clears saved profile decisions;
Incognito and Tor decisions do not appear there because they are memory-only.

### Windows Single Sign-On

The global `browser-windows-sso` setting is opt-in and defaults to off. The renderer sends its
initial value and later changes to the main process over the typed
`Endpoint.setWindowsSsoEnabled` IPC endpoint; main keeps only this boolean policy. The setting
appears in Settings â†’ Browser â†’ Browser Profiles.

When enabled on Windows, the sole `session.webRequest.onBeforeSendHeaders` listener in
`network-logger.ts` may add Windows sign-in proof to `mainFrame` and `subFrame` HTTPS requests
whose normalized origin is exactly `https://login.microsoftonline.com` or
`https://login.live.com`. Eligibility is derived from the Electron `Session`: it must be
persistent and its storage path must identify a `Partitions/browser-<name>` profile. The result
is cached per Session, which excludes Incognito and Tor because their sessions are in-memory.
Other requests, origins, and platforms keep the normal pass-through path. The policy does not
discover tenant or sovereign-cloud endpoints.

For an eligible request, `windows-sso.ts` starts a fresh `persephone-snip.exe sso-cookies <uri>`
process. The Rust helper calls Windows' `IProofOfPossessionCookieInfoManager`, emits the cookie
records as JSON on stdout, and emits no diagnostic details. The adapter discards stderr, parses
stdout, and returns no cookies if the helper is missing, fails, or exceeds its 3000 ms deadline.
It maps `x-ms-*` records to individual headers and other records to the existing `Cookie` header.

These values are transient credentials. They stay in the main process, are not cached or sent
over IPC, and are removed from the cloned request headers before `network-logger.ts` stores an
entry for the browser network log. Keep the SSO composition inside that one listener because
Electron supports only one `onBeforeSendHeaders` listener per session.

### Profile Settings

Profiles are stored in app settings as `BrowserProfile[]` (`{ name, color }`). A separate `browser-default-profile` setting tracks which profile the "Browser" quick-add menu item uses. Colors come from the `TAG_COLORS` palette in `palette-colors.ts`, and the built-in default uses `DEFAULT_BROWSER_COLOR` (cyan `#4DD0E1`).

The page-level title is privacy-projected separately from the active tab title. `browserPageTitle()`
returns the constant `"Browser"` for incognito and Tor pages, so the Persephone tab strip and MCP
page summaries cannot identify the site being viewed. Internal browser-tab labels continue to use
the real `pageTitle`, which preserves the user's ability to distinguish tabs inside the private
session.

### Page Tab Icons

| Mode | Icon |
|------|------|
| Default profile (no name) | GlobeIcon tinted with `DEFAULT_BROWSER_COLOR` or default profile's color |
| Named profile | GlobeIcon tinted with the profile's color |
| Incognito | IncognitoIcon |
| Tor | TorIcon (purple onion, branded colors) |

The `resolvedColor` getter on `BrowserEditor` resolves the color chain: explicit profile → default profile setting → `DEFAULT_BROWSER_COLOR`.

### Incognito Indicator

Incognito pages show an `IncognitoIcon` inside the URL bar's left edge, using the `startButtons` prop on `TextField`.

### Tor Mode

Tor mode routes all webview traffic through the Tor network via a SOCKS5 proxy. Like incognito, Tor partitions are ephemeral (no `persist:` prefix). The Tor process is managed lazily — started on first Tor page open, stopped when the last Tor page closes. Script `app.fetch()` and board `persephone.fetch()` calls can also acquire fetch leases: Tor starts on demand and remains available while a routed response body is consumed, then has a 60-second idle grace period before stopping.

**Architecture:**
- `src/main/tor-service.ts` — manages `tor.exe` child process lifecycle, generates minimal torrc, sets the `socks5://` proxy per partition through the shared `session-proxy.ts` helper, and tracks page and fetch leases
- `src/ipc/tor-ipc.ts` — IPC channels for partition lifecycle and status, plus fetch lease acquire/release
- `src/renderer/editors/browser/TorStatusOverlay.ts` — native overlay shown during connection with live log, spinner, and reconnect button
- `src/renderer/ui/dialogs/TorInfoDialog.ts` — connection info dialog (exit IP, location, Reconnect)
- `activePartitions: Set<string>` and renderer fetch-lease counts act as consumer counters — Tor stops only when all consumers are released and the fetch idle grace period expires

**Tor indicator in URL bar:** A clickable TorIcon with a small status dot (green=connected, red=error, yellow=disconnected). Clicking toggles the `TorStatusOverlay`.

**Session restore:** Tor pages are restored with `torStatus: "disconnected"`, `torOverlayVisible: true`, and an empty tab. User must click "Reconnect" — no auto-connect on restore.

**Window close cleanup:** `BrowserTorModel` subscribes to the `windowClosing` event (from `GlobalEventService.beforeunload`) to release Tor partitions when the window closes without explicit tab disposal.

#### The partition fails closed

An Electron session with no proxy is **DIRECT**, so the absence of a proxy is not a neutral
state — it is an unproxied one. The proxy is therefore applied to the partition *before* the
daemon exists, not once it bootstraps:

1. `BrowserTorModel.armProxy()` invokes `tor:arm`, and it is awaited from
   `BrowserEditor.restore()` — which runs on **every** path that produces a Tor page, session
   restore included, and always before the page is added to the window. That ordering is
   load-bearing: `addPage` mounts the first `<webview>` with its `src` already set, so the guest
   starts fetching immediately, whereas a cold daemon bootstrap takes seconds.
2. `TorService.armPartition()` points the session at the SOCKS port while nothing is listening
   on it yet. Anything that loads during the bootstrap window therefore fails with
   `ERR_SOCKS_CONNECTION_FAILED` instead of reaching the network.
3. `settleStart()` applies the proxy on **both** start outcomes. On success that is what puts
   traffic on Tor; on failure it is what keeps the partition failing closed, so a daemon that
   never bootstraps does not leave a page browsing normally.

`armTorProxy` is idempotent — the flag is set only on success — because three callers each have
to guarantee arming without being able to see whether another already did:

- **`restore()`** is the one that always runs, and it records a failure into `torStatus` rather
  than throwing, so a failed arm never drops a page from a session restore.
- **`showBrowserPage`** re-asserts it and, if arming fails, notifies and **does not open the
  page** — a Tor page whose partition could not be proxied would browse over the normal network,
  so no page is the correct outcome.
- **`reconnectTor`** covers a partition whose earlier arming failed. It matters because
  `initTorProxy` reaches `setProxyForPartition` only *after* the daemon settles: on a cold daemon
  that is another 5–30 s window, and it is reachable, since a restored Tor page resets its tabs
  to `about:blank` but leaves the URL bar live.

Arming deliberately does not add the partition to `activePartitions`. That set, via
`isActiveTorPartition()`, answers a different question — "is this a live, *bootstrapped* Tor
session?" — for the `tor-src://` handler and `checkIp`, and an armed partition is not one yet.

Consequently no navigation site consults `torStatus`: the armed proxy is the single enforcement
point, rather than a check duplicated across `navigateWebview`, `addTab`, and the URL bar.

One gap remains by design. A daemon that dies is caught — `child.on("close")` broadcasts
`tor:status` `"error"` when `isCurrent(child)` still holds, which distinguishes an unexpected
exit from a deliberate `stopTorProcess()` or `restart()` (both null out `torProcess`
synchronously, before their own close event arrives). But a daemon that stays alive while its
circuits fail keeps a green dot: detecting that needs active probing. It is a status-honesty
gap, not a leak — such requests already fail closed.

#### The proxy covers the webview, not the renderer

The proxy — Tor's, or a proxied profile's (see [Profile network](#profile-network)) — is attached
to the **page's session partition**, so it covers only what the `<webview>` loads. Renderer-side
code runs in the app window's own session (`nopersist`), which is unproxied. Any feature that
fetches a remote URL from the renderer on behalf of a routed page therefore bypasses the route
unless it is routed deliberately. `BrowserProfileNetworkModel.imageRoute` is the one place that
answers "how does app-drawn content of this page reach the network": a Tor route, a profile route,
or `null` for a direct page.

The consequences handled explicitly:

- **Link-editor images.** The page's blank tab renders the bookmarks `LinkEditor`, whose tile and
  tooltip images are plain `<img>` tags in the app renderer. `LinkEditor.imageProxySource` (wired by
  `BrowserTabsModel.configureBookmarks`) returns the page's `ImageRoute`, and `resolveRoutedSrc()`
  (`src/renderer/editors/link-editor/routed-src.ts`) rewrites remote `src` values to
  `tor-src://<partition>/?u=<encoded url>` or `profile-src://<token>/?u=<encoded url>`. Local
  schemes (`data:`, `blob:`, `file:`, `app-asset:`) pass through untouched, and while a Tor circuit
  is not connected the image is not rendered at all rather than fetched direct.
- **Tab-strip favicons.** `BrowserTabsPanel` draws each tab's favicon with an `<img>` in the app
  renderer, so it resolves the URL through the same route (`routeSrc`).
- **Favicon persistence.** Favicons are normally written to the app data folder.
  `LinkEditor.isPrivatePage` (true for a route marked `private` — Tor, and a proxied Incognito page)
  gates the `requestFaviconSave` call sites, and `BrowserView`/`BrowserBookmarksUIModel` skip the
  save for Tor and incognito. The marker set behind `requestFaviconSave` is module-level and shared
  by every browser page, so a marker armed from a private page would otherwise be honoured later by
  another one. A proxied profile is persistent, so it does save favicons, but downloads them with
  renderer `fetch()` through its `profile-src://` route (`routedFetchUrl`) instead of Node `https`.
- **Opening a resource out of the page.** "Open Image in New Tab" asks main for a one-URL
  `session-src` handle (`browser-network:session-source`) and opens the image through it; the image
  editor then shows the bytes, not the URL. A routed page whose route is down opens nothing.
  Board-claimed downloads get a `session-src` handle for proxied persistent sessions as they do for
  Tor and incognito ones.
- **Resources list.** "Show Resources" opens a standalone Link page that outlives the browser page,
  so on a routed page it is opened without image thumbnails.
- **WebRTC.** An `app.on("web-contents-created")` hook in `browser-network-service.ts` sets
  `disable_non_proxied_udp` on every webview guest whose session is a Tor or proxied one, before its
  first navigation — which works because the proxy is applied before the page mounts.

The route resolver lives in `link-editor/`, not `browser/`, to keep the dependency arrow one-way —
`browser` already imports `link-editor`.

#### `tor-src://` scheme

`src/main/tor-src-protocol.ts` registers a handler on the app window's session that fetches an
arbitrary `http(s)` URL through a Tor partition's session, so the SOCKS proxy applies. Three guards
are load-bearing and required together:

1. The host must match the `browser-tor-<uuid>` partition shape.
2. `TorService.isActiveTorPartition()` must confirm a live, bootstrapped Tor session — the scheme is
   inert whenever no Tor page is running.
3. The target must be `http:` or `https:`.

The target URL travels in a `?u=` query parameter rather than a path segment: Chromium canonicalizes
`standard: true` scheme paths and can rewrite percent-escapes, corrupting a target that carries
escapes of its own. Responses are returned with `Cache-Control: no-store`, and the scheme is
registered **without** `corsEnabled` — enabling CORS would turn it into "any document in the app
session can read arbitrary cross-origin content through Tor".

#### Connection info dialog

A `QuestionIcon` toolbar button, rendered only for Tor pages, opens `TorInfoDialog`. (The same
dialog in proxy mode, opened from a proxied page's "Proxy" chip, shows the egress IP and location
only.) It reports the
exit IP, an approximate location, and whether `check.torproject.org` confirms the request arrived
over Tor. Lookups run in main (`TorService.checkIp`) via `session.fromPartition(partition).fetch()` —
a renderer-side fetch would go out unproxied and hand the checker the user's real IP. The exit-IP call
and the geo providers carry separate timeouts, and a failing geo provider still leaves the IP visible.

**Reconnect** restarts `tor.exe` (`TorService.restart`) rather than signalling `NEWNYM` over a control
port; that keeps `torrc` untouched and adds no loopback control surface. Two invariants make the
restart safe:

- The old process's `close`/`error` handlers only clear shared state when
  `this.torProcess === child`. The old child's `close` event arrives after the replacement is already
  assigned, so an unguarded reset would null out a healthy process and leave `running` false while
  Tor is up.
- `stopTorProcessAndWait()` awaits the old process's exit before respawning. Tor holds a `lock` file
  inside its `DataDirectory`, and a replacement that races the exit fails to start.

Because the daemon is shared, a restart affects every open Tor page. Their `torStatus` lives in
renderer state that main cannot see, so `TorService` broadcasts `tor:status` and each Tor page's
`torStatusListener` follows it — otherwise the other pages would keep showing a green dot while Tor
is down. A new circuit may legitimately reuse the same exit node, so the dialog reports an unchanged
IP as such instead of implying the reconnect failed.

### Profile network

Each browser profile, the built-in Default profile, and Incognito can use a SOCKS5 or HTTP proxy
instead of a direct connection: `BrowserProfile.network`, `browser-default-network`, and
`browser-incognito-network` hold a `BrowserNetwork` (`{ kind: "direct" }` or
`{ kind: "proxy", protocol, host, port }`), with no credentials.

At the Chromium level a proxied page is the same as a Tor page: its session gets exactly one proxy
through `applySessionProxy` (`src/main/session-proxy.ts`) — `mode: "fixed_servers"`, empty bypass
rules, no `direct://` fallback, then `closeAllConnections()` — so an unreachable proxy fails with
`ERR_PROXY_CONNECTION_FAILED` / `ERR_SOCKS_CONNECTION_FAILED` rather than browsing direct. Chromium's
implicit loopback/link-local bypass is kept: routing `localhost` into a remote proxy would only
break local development. With SOCKS5, host names are resolved by the proxy.

The difference is lifetime. A profile partition (`persist:browser-<name>`) is shared by every page
of the profile in every window for the whole run, and Electron does not persist `setProxy`, so it
must be applied again before the first page of each run mounts. An Incognito page has its own
in-memory partition, released when the page closes.

- **Apply before mount.** `BrowserProfileNetworkModel.armProxy()` invokes `browser-network:apply`
  from `BrowserEditor.restore()` — the same ordering Tor relies on. `BrowserNetworkService.apply` is
  idempotent per partition: an unchanged network joins the pending or finished apply, so the Nth
  page of a profile neither resets its connections nor mounts before the first apply settles.
- **Fail closed.** If main cannot apply the proxy (a hand-edited invalid host), `networkError` is
  set: `showBrowserPage` refuses a new page, and an existing or restored page keeps its tabs but
  mounts **no webview** — `BrowserView` passes an empty page list to the page manager and shows
  `ProfileNetworkErrorView` with Retry. Fixing the setting re-applies it.
- **Follow edits.** The model subscribes to the three settings and re-applies on change; main
  closes connections, re-issues the `profile-src` token, and re-applies the guest WebRTC policy to
  existing guests. Documents already loaded keep their route until reloaded, so a notice says so.
- **`profile-src://`.** The `tor-src` counterpart for proxied sessions, registered on the app
  session. Its host is an opaque token main issues per proxied partition (a partition name such as
  `persist:browser-My Profile` is not a valid URL host); an unknown or revoked token is refused, and
  only `http(s)` targets are fetched. Unlike `tor-src`, it is `corsEnabled` so the favicon cache can
  read the bytes. That is safe here because the host is an unguessable random token that only the
  browser page's own renderer code holds (never a board frame), whereas a `tor-src` host is a
  guessable partition name.
- **Incognito release.** Disposing an Incognito page calls `browser-network:release`, so main
  forgets its partition and token.

A proxied page shows a "Proxy" chip in the URL bar (`url-proxy-indicator`) that opens the
connection dialog in proxy mode (`browser-network:check-ip`, through the page's session).

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

Located in `src/renderer/editors/browser/browser-pages.ts` (reached through a thin dynamic-import delegate on `PagesLifecycleModel`, so the browser chunk stays out of startup). Resolves to the id of the browser page the URL was opened in (`undefined` only when no page could be opened, e.g. Tor misconfiguration) — `pages.openUrlInBrowserTab` returns the page id so agents can target it explicitly instead of relying on the active-page default. Two search strategies depending on the source:

**Internal links** (Monaco, Markdown — `link-open-behavior: "internal-browser"`):
1. Search pages to the **right** of the active page for a matching browser tab
2. If not found, search pages to the **left**
3. If still not found: create a new Browser page (using the default profile) as the last tab

**External links** (IPC from main process via `eOpenExternalUrl`, e.g. default browser registration):
1. **Prefer the active page** if it's already a matching browser tab
2. If not, search **all pages** (left to right) for a matching browser tab
3. If still not found: create a new Browser page (using the default profile) as the last tab

For existing browser tabs: if the tab has only one empty (`about:blank`) internal tab, `navigate(url)` reuses it; otherwise `addTab(url)` creates a new internal tab.

**Matching criteria:** A browser page matches only if it is **not** incognito and **not** Tor. Incognito and Tor pages are always skipped — a normal URL is never opened in a private session automatically. When `options.incognito` is explicitly `true`, only incognito pages match (Tor pages are still excluded).

### Markdown Link Context Menu

Right-clicking a link in Markdown Preview (or Notebook embedded Markdown) shows additional items for external URLs (http/https) via the shared `appendLinkOpenMenuItems()` helper:
- "Open in Default Browser" — `shell.openExternal(href)`
- "Open in Internal Browser" — `openUrlInBrowserTab(href)`
- Per-profile items — `openUrlInBrowserTab(href, { profileName })` for each configured browser profile
- "Open in Incognito" — `openUrlInBrowserTab(href, { incognito: true })`

### Exceptions

- **About card links** (repository, issue reporting, and downloads) continue to use the OS default browser or the update flow as appropriate. The About guide browser handles application-guide links in-pane; its **Open in tab** action uses the `persephone-guide://` content pipeline.
- **HTML Preview** blocks all link navigation (unchanged)
- **Browser Editor** has its own link handling (new internal tabs, context menu) — not affected
- **Local markdown links in Markdown Preview** are intercepted in the renderer and navigate the **current page** in place (with a per-page Back history) — they never reach the main-process `will-navigate` → new-tab path above. Only non-markdown and external links from the Markdown view use the routing described here. See [Pages Architecture → Markdown in-page navigation](pages-architecture.md#markdown-in-page-navigation).

## Bookmarks

Each browser profile can be associated with a `.link.json` bookmarks file. A configured file is preloaded silently after the browser page is created; encrypted files defer initialization until the first user action (star button or "Open Links"). The loaded resource is reused for the lifetime of the browser page.

### Architecture

```
BrowserEditor
    └─ BrowserTabsModel.bookmarks
        ├─ TextFileModel — file I/O, encryption, FileWatcher, auto-save
        └─ LinkEditor   — parsed link data, categories, tags, filters
```

`BrowserBookmarks` wraps both models. `TextFileModel` handles reading/writing the `.link.json` file (including encryption/decryption), while `LinkEditor` provides the structured data layer. Every mutation flows through `LinkEditor.onDataChanged()` → `TextFileModel.changeContent()` → debounced save to disk.

### Initialization Flow

Bookmarks load through two paths:

**Eager preload (silent):** The `BrowserTabsModel` constructor schedules `preloadBookmarks()` after a 300ms delay. It checks for a configured bookmarks file, calls `BrowserBookmarks.init({ silent: true })` which skips the password dialog for encrypted files. If successful, bookmarks appear immediately on blank tabs. If encrypted, bookmarks stay null until the user triggers manually.

**Manual trigger (interactive):** User clicks ☆ (star) or "Open Links" → check `model.tabs.bookmarks !== null` → if null, read the profile's bookmarks file path through `model.tabs.getBookmarksFilePath()` → if no file path, show "Associate Bookmarks File" dialog → create `BrowserBookmarks(filePath)` → `model.tabs.initBookmarks(filePath)` with a password dialog if encrypted → store on `BrowserTabsModel.bookmarks`.

After initialization, `BrowserTabsModel` sets two callbacks on `linkModel`:
- `onLinkOpen` — modifies the link event data before it enters the `openRawLink` pipeline: sets `target: "browser"` and `metadata.browserPageId` pointing to the owning browser page. The HTTP resolver's browser branch then routes the URL to that specific page (navigates current blank tab via `browserTabMode: "navigate"`, or adds a new tab if the current tab has content).
- `onGetLinkMenuItems` — returns an "Open in New Tab" menu item that calls `BrowserTabsModel.addTab(url)`. These items are prepended to the link context menu (before "Edit"), providing mouse-only access to new-tab behavior without requiring `Ctrl+Click`.

### Three Entry Points

- **Blank page overlay** — when a tab shows `about:blank` and bookmarks are loaded (not encrypted), the `BlankPageLinksView` renders the Link Editor over the empty webview. Has its own toolbar (with breadcrumb, view mode, search). Disappears when user navigates to a URL.
- **Star button (☆)** in the URL bar — quick bookmark add/edit. Empty star when URL not bookmarked, filled star when bookmarked. Opens Edit Link Dialog with URL/title prefilled and discovered images. Everything the handler does before the dialog is async (bookmark-file setup, favicon caching, the page image probe), so it is guarded by a `starClickBusy` flag: without it, a user clicking again because nothing has appeared yet gets one dialog per click, all opening together once the awaits settle.
- **"Open Links" button** on the toolbar — opens the `BookmarksDrawerView`, a right-anchored overlay with the full Link Editor. Link clicks navigate to the URL (in current tab if `about:blank`, otherwise new internal tab) and close the drawer.

### Image Discovery

Images for bookmarks are collected from multiple sources:

1. **Meta tags** — `og:image`, `twitter:image`, `meta[name="thumbnail"]` extracted via `executeJavaScript` on the webview, bounded by `IMAGE_DISCOVERY_TIMEOUT` (1 s) — see [Bounding page probes](#bounding-page-probes)
2. **Click tracking** — the preload script captures all `<img>` URLs inside clicked `<a>` elements and sends them via `ipcRenderer.sendToHost("clicked-images", urls)`
3. **Per-tab image tracking** — `trackedImagesRef` stores discovered images per internal tab with navigation levels (level 0 = current page, level 1 = previous page, level 2 = two pages back; levels > 2 are dropped)
4. **Context menu** — "Use Image for Bookmark" pushes an image URL to level 0; "Add to Bookmarks" captures href, imgSrc, and title from the right-clicked element

All discovered images are merged (deduplicated) and passed to the Edit Link Dialog.

Only source 1 reads the live page, and it is the one that can be slow. The URL, title and favicon the dialog needs all come from the browser's own tab state, so a page that cannot answer costs image *suggestions* and nothing else.

### BookmarksDrawer

A right-anchored native overlay that renders the Link Editor with Categories/Tags panel on the right. Key behaviors:

- Initial width = 60% of browser page, max 90%, resizable via Splitter
- Width persisted in component state
- The parent builds drawer props at use time. The drawer may recover a zero initial width during
  `mount()` by writing the measured width back to browser state, so a post-mount update must read
  the current state rather than reuse a pre-mount props snapshot.
- Closes on Escape, backdrop click, or link click navigation

### Embedded Link Editor Composition

The browser embeds native Link Editor views for toolbar, body, secondary views, and footer content.
To support multiple simultaneous instances (blank page overlay + BookmarksDrawer), each native
composition owns its own DOM hosts while the shared `TextFileModel` remains the data source.

### Encrypted Bookmarks

If the `.link.json` file is encrypted, `BrowserBookmarks.init()` detects this via `isEncrypted(content)` and calls `showPasswordDialog({ mode: "decrypt" })`. This is the same async password dialog used by the text editor's encryption feature. If the user cancels, `init()` returns `false` and the bookmarks are not loaded. The `silent: true` option skips the dialog entirely (used by eager preload).

## Keyboard Shortcuts

Browser hotkeys (F5, F12, Alt+Left/Right, etc.) must work regardless of where focus is — inside the webview, on the toolbar, or elsewhere. Browser-owned handling uses three layers; F12 also has an application-wide fallback for windows without an active browser page:

### Layer 1: Main Process (`before-input-event`)

When focus is inside a `<webview>`, keyboard events are consumed by the guest page and never reach the renderer's DOM. The main process intercepts these via `webContents.on("before-input-event")` in `browser-service.ts`, handling F5, Ctrl+R, F12, and Alt+Left/Right directly on the webContents. Escape is intercepted there only while that webview is in HTML fullscreen; otherwise it reaches the guest page and the preload handles it after the page has had a chance to claim it.

### Layer 2: Global Key Event Bus (`globalKeyDown` Subscription)

When focus is on any renderer element (toolbar, URL bar, tab panel, or no specific focus), the browser editor subscribes to a global keyboard event bus. `MainPageView` broadcasts all `keydown` events via `globalKeyDown.send(e)` (defined in `events.ts`). `BrowserEditor` subscribes in its constructor and handles browser hotkeys only when it's the active page. This keeps browser-specific logic out of the shell composition view.

### Layer 3: Root div `onKeyDown` (`BrowserWebviewModel`)

The root browser `<div>` handles `Ctrl+L` (focus URL bar) and `Ctrl+F` (find in page) — shortcuts specific to the browser UI that don't need global reach. This layer covers focus on Persephone's own chrome; `Ctrl+F` with focus *inside* the page is decided by the guest preload instead (see below).

### Supported Hotkeys

| Shortcut | Action | Layers |
|----------|--------|--------|
| `F5` | Reload | Main process + global |
| `Ctrl+F5` / `Ctrl+Shift+R` | Hard reload | Main process + global |
| `Ctrl+R` | Reload | Main process + global |
| `F12` | Open the browser page's DevTools | Main process + browser page global |
| `Alt+Left` / `Alt+Right` | Back / Forward | Main process + global |
| `Alt+Home` | Go to home page | Global only |
| `Escape` | Exit HTML fullscreen, or stop loading / close find bar | Main process (fullscreen only), global (host focus), and guest preload (page focus) |
| `Ctrl+L` | Focus URL bar | Root div only |
| `Ctrl+F` | Find in page | Root div (host focus) + guest preload (page focus) |

When focus is on renderer chrome, the active `BrowserEditor` handles F12 on the global key event bus
and calls `openDevTools()` on its active webview. After all global-key subscribers run,
`KeyboardService` opens the current Persephone window's DevTools if F12 remains unclaimed. This
fallback also works in windows whose active page is not a browser. It crosses to the main process
through the typed `Endpoint.openDevTools` IPC handler, which opens DevTools for the sender's window.

#### `Ctrl+F` and ordinary `Escape` are the two keys the page can take

The other Layer 1 rows above are claimed unconditionally in `before-input-event`, which runs in the
main process *before* the key is dispatched to the guest page. For `Ctrl+F` and ordinary `Escape`
that was wrong:
a page with its own find UI, or one that closes a popover on `Escape`, could never claim the key,
because `preventDefault()` there means the page's DOM never sees the keydown at all. Chrome and Edge
instead give the page first refusal and apply the browser meaning only to unclaimed keys.

So both are absent from the unconditional shortcut handling in `before-input-event`, and the
decision lives in `src/preload-webview.ts`. The choice cannot be made synchronously: the preload
runs at document-start, so on any node and phase its listener is registered first and therefore runs first —
a page handler on `document` has not executed yet and `defaultPrevented` is still false. Switching
to the bubble phase does not help, since registration order decides among listeners on one node.
The preload reads the flag from a **`setTimeout(0)` task** instead, which resolves after the whole
propagation and is independent of both node and registration order; if the flag is still clear, it
sends `show-find-bar` to the host as before. It has to be a task and not a microtask: for a real,
browser-dispatched event the JS stack is empty between listeners, so a microtask checkpoint runs after
*each* one and a `queueMicrotask` check fires before the page's handler. Only a script-driven
`dispatchEvent()` (or a CDP-injected key) defers microtasks past the whole dispatch — so a synthetic
test passes where a real keypress fails.

Two consequences worth knowing. The verdict is per keystroke, not per page, so a page that claims
the key normally but stands down while a modal is open yields the browser bar for exactly those
presses. And the preload only runs in the main frame (the webview does not enable
`nodeIntegrationInSubFrames`), so `Ctrl+F` with focus inside a cross-origin iframe reaches that
frame and stops there rather than opening the find bar.

`Escape` follows the same shape when the webview is not in HTML fullscreen: cinema mode takes it
outright (Persephone's own overlay), otherwise the deferred check runs `window.stop()` and sends
`hide-find-bar` only when the page left it unclaimed. In HTML fullscreen, the main process takes
Escape before guest dispatch and asks the page to exit fullscreen; the page's own fullscreen event
also clears the view state when the user uses its fullscreen controls.

### HTML Fullscreen

When a page enters HTML fullscreen (for example, through a video's fullscreen control), Electron
makes the host `BrowserWindow` fullscreen but keeps the guest `<webview>` inside its editor-sized
box. `BrowserWebviewItemView` marks its wrapper and CSS stretches it across the app window, covering
the browser chrome. The wrapper also opts out of Electron's drag region while fullscreen. A
capturing `document` keydown listener in `BrowserWebviewItemView` sends the fullscreen-exit request
when Escape is pressed while focus is in Persephone chrome, so this path does not depend on the
guest page receiving the key.

The renderer and main process both track the webview's `enter-html-full-screen` and
`leave-html-full-screen` events. If the fullscreen webview becomes hidden because the user changes
pages or opens another tab, a `ResizeObserver` removes the fullscreen presentation and sends
`BrowserChannel.exitHtmlFullscreen`. The main process asks the guest to exit and tracks fullscreen
per webview registration, so it leaves the host window fullscreen only after no registered webview
needs it. It forces the window out after a one-second fallback if the guest does not respond, and
unregistering a fullscreen webview also releases the window. Escape requests the same exit while
HTML fullscreen is active, whether focus is in the guest or Persephone chrome. Window bounds are not
persisted during fullscreen, avoiding restoration of the display-sized bounds as a normal window on
the next launch.

The main process also tracks the last mouse press per webview registration. If focus leaves the
guest, its host window blurs, or the press opens a new tab or popup before the matching mouse-up
reaches the page, the service sends a mouse-up at the last pointer position. This prevents the page
from retaining a pressed-button state after the release was routed elsewhere.

### Reload and the `beforeunload` guard

A guest page with a `beforeunload` handler (e.g. an unsaved-changes guard) tries to cancel any reload/navigation. Electron's default for the resulting `will-prevent-unload` event is to **silently cancel the unload** — no prompt, no reload — which makes Reload/F5 appear dead. `browser-service.ts` handles `will-prevent-unload` to fix this:

- **Soft reload** (toolbar button, `F5`, `Ctrl+R`) → a native confirm ("You have unsaved changes. Leave the page and discard them?"); **Leave** allows the unload (reload proceeds), **Cancel** keeps the page.
- **Hard reload** (`Ctrl+F5` / `Ctrl+Shift+R`) → bypasses the prompt and force-reloads.

The bypass uses a one-shot `bypassUnloadGuard` flag on the per-webContents `RegisteredWebview`: armed by a hard reload, consumed (and cleared) by the `will-prevent-unload` handler, and cleared defensively on `did-stop-loading` so it can never leak to a later reload. Because the flag lives in the main process, both keyboard layers must arm it there:

- **Layer 1** (`before-input-event`, focus inside the page) sets `reg.bypassUnloadGuard` and calls `wc.reloadIgnoringCache()` directly.
- **Layer 2** (`globalKeyDown`, focus on browser chrome) calls `BrowserWebviewModel.hardReload()`, which sends the new `BrowserChannel.hardReload` IPC (key `${tabId}/${internalTabId}`); the main handler arms the flag and reloads — mirroring Layer 1 so both paths have identical semantics. (Soft reload stays renderer-side via `reloadOrStop()` → `<webview>.reload()`, which still triggers the confirm.)

## Scripting Facade

Scripts access browser pages via `page.editor`, which returns a `BrowserEditorFacade`. Like all editor facades, this wraps the underlying `EditorModel` subclass (`BrowserEditor`) directly; the editor then composes focused sub-models — there is no separate view-model layer.

```javascript
const browser = page.editor;
browser.navigate("https://example.com");
await browser.waitForNavigation();
const snapshot = await browser.snapshot();  // accessibility tree (YAML)
await browser.click("#submit-btn");
await browser.type("#input", "text");
const tabs = browser.tabs;                  // list of internal tabs
```

**Interface:** [`IBrowserEditor`](../../src/renderer/api/types/browser-editor.d.ts) — navigation, query (getText, getValue, exists), interaction (click, type, select, check), wait methods, tab management, CDP access, accessibility snapshot
**Implementation:** [`BrowserEditorFacade`](../../src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts)

The facade has an optional page-authored `.app` child. After `did-stop-loading` for a real document,
`BrowserWebviewModel` evaluates a null-safe `window.__aiVision` probe unless the existing privacy gate
refuses the page. A valid serialized shape is retained per internal tab and document generation;
`BrowserEditorFacade` mounts it through `createRemoteProxy` only for the active tab. A navigation,
reload, tab switch, close, or model disposal invalidates that binding, so a prior document cannot
answer a request for a new one. The proxy revalidates the page's live `version` through CDP before
each remote request, so lazy revalidation remains correct even if a signal is missed. For a
registered model, the probe also installs the package's `Runtime.addBinding` host signal. The main
CDP service listens only for that binding's `Runtime.bindingCalled` message and routes it over the
browser IPC event channel; a shape signal records a host event and triggers a background re-probe,
while a page `notify(text)` becomes a rate-limited, page-attributed event. The proxy sender invokes
the page's remote handler through CDP with the shared timeout policy and labels the page-authored
subtree as data. The `.app` subtree does not contribute to the page or `pages` overview descriptors.

## Browser Automation (MCP)

Browser automation lives in `src/renderer/automation/`. `operations.ts` provides shared operations
for browser pages (`BrowserTargetModel`), trusted board frames (`BoardTargetModel`), and the app
window (`AppTargetModel`). The facades are `BrowserEditorFacade`, `BoardEditorFacade`, and
`window.screen`; `BROWSER_AUTOMATION_MEMBERS` describes the shared operation set. Browser pages add
navigation, tab, query, viewport, and dialog members; boards add board state and frame selection;
the app target has no browser navigation or tab API.

```text
call -> resolved facade/target -> operations.ts -> CDP session for resolved element -> result
```

The path-based `call` route and scripting facades use the same operation layer. `call-tools.ts`
turns screenshot payloads into native MCP image blocks with metadata. Browser and board targets are
activated before actions because their content needs a visible webview. `window.screen` targets the
calling app window.

### Target resolution and privacy

`pages[pageId].editor` addresses a specific browser or board page. `pages.openUrlInBrowserTab(url,
{ profileName })` chooses or opens a page in a profile; an empty profile selects the default.
`window.screen` addresses the calling app window and `windows[i].window.screen` another app window.

Browser targets are checked for `isIncognito`, `isTor`, and ephemeral `openedByAgent` provenance.
User-owned private pages are inaccessible; an agent-opened private page is accessible to that agent
until restored. The rule lives in `editors/browser/agent-access.ts` and also guards AiVision page
summaries. The app target is refused while its active page is private because its snapshot includes
that page. Inactive pages are hidden and absent from the AX tree. This browser-automation boundary
does not constrain trusted `script.execute`.

### Shared input and actionability

The shared resolver in `operations.ts` accepts a CSS selector or snapshot ref. Selector actions
filter to visible matches, fail immediately on multiple matches, and accept a zero-based `{ nth }`
among visible matches. Before trusted actions it checks attachment, visibility, stability across
two animation-frame measurements (with a bounded timer fallback), enabled state, and hit-testing
at the dispatch point. Transient failures retry on timers to the operation timeout (5 seconds by
default). `{ force: true }` skips all checks. `requestAnimationFrame` is used only for this bounded
stability check, not wait polling.

Trusted CDP mouse and keyboard input is the default. `{ synthetic: true }` explicitly chooses the
legacy DOM/value compatibility path; trusted dispatch failures do not fall back silently. Each
element ref resolves its CDP input session: browser main frames use the webview session, OOPIF refs
use their flattened frame session, board refs use their registered board-frame session, and app
refs use the app-window or resolved frame session. Same-process ancestor frame offsets are applied
by the target. The app target's webview boundary remains separate: its snapshot includes the active
page subtree allowed by the target but excludes browser webviews and their frames.

`type()` focuses by trusted click, replaces existing content, and inserts through CDP for text-like
inputs and contenteditable. Mapped `slowly` characters produce key events; native date/time/color/
range controls use validated value assignment and untrusted `input`/`change`; file inputs use
`setInputFiles`. `select()` changes native `<select>` values programmatically and dispatches
untrusted `input`/`change`; custom dropdowns use trusted click and keys. It currently also receives
full pointer actionability and hit-testing. Ctrl+C/V use the OS clipboard without save/restore.

CSS `:hover` does not apply inside browser `<webview>` elements, even though trusted pointer events
are delivered. This limitation is specific to browser webviews; page script listeners can respond.

### Snapshots and refs

`snapshot({ root, interactive, maxNodes, maxChars })` formats AX trees. It can scope to a CSS
selector or `{ ref }`, keep actionable elements plus context with `interactive`, and cap output.
Oversized results end in `# Shortened ... Not shown: ...` with a recovery hint; omitted dialog or
landmark refs can be used as a new root. Clickable roleless controls carry `[cursor=pointer]`.

The pipeline reads the current frame's AX tree, discovers attached iframe targets, gets their AX
trees through flattened sessions, and merges them under iframe placeholders. Discovery filters to
iframes descended from the current target id; it excludes other browser tabs, unrelated webviews,
and background private pages. Main-frame refs are `e123`; iframe refs are `f1-e456`. `ref.ts`
dispatches DOM work through the session that minted each ref. New snapshots replace only that
target's ref map; replaced documents/nodes make refs stale, and refs from another host are rejected.
Text-node refs are coerced to their displaying element for element operations.

### Page events, waits, and navigation

`src/main/cdp-service.ts` records page events per webContents or frame session via
`subscribeCdpEvents`: dialogs, console records, page errors, network requests, execution contexts,
and lifecycle/navigation state. Browser webview registration preserves that state with
`keepCdpState` while `dom-ready` re-registers the same webContents.

An automation activity begins before an operation. Dialog preflight handles a pending dialog under
the configured policy or blocks the operation in manual mode. During automation and a two-second
grace period, the default dismiss policy handles dialogs and records them; a dialog opened while
the agent is idle stays user-controlled. `dialogs()` reports pending and handled records.

Navigation waiters arm against main-process Page lifecycle events before triggering navigation,
then await the selected `load`, `domcontentloaded`, or `networkidle` condition. `navigateAndWait`,
`back`, and `forward` return `{ url, status }`; HTTP errors resolve with status, main-frame network
failures reject. `waitForNavigation` can adopt an in-progress navigation, and `waitForURL` accepts an
exact string or regular expression. Selector and text waits use 100 ms timers, not animation-frame
polling. Their default is 10 seconds; explicit MCP wait deadlines add five seconds and cap at
600,000 ms so the wait's own error can arrive first.

`window.screen` console/error reads cover Persephone's renderer. JS dialog policy is exposed on
browser and board targets only. Browser-only viewport emulation changes page metrics inside the
existing webview bounds.

### Network response inspection

`networkRequests()` returns the browser page's bounded request log. Response bodies are opt-in
with `includeBodies`; the main process retrieves them from CDP only while Chromium still retains
the response, and only for requests observed after automation first initializes that tab. The
default body limit is 64 KiB and the maximum is 1 MiB. Binary response bodies are
returned as base64, and oversized or unavailable bodies are omitted or marked truncated. This
response-body path is browser-page-only; body capture is not enabled for boards or `window.screen`.

`waitForResponse()` is available on browser pages, boards, and `window.screen`. It matches a final
response URL (exact string or regular expression) and resolves at response headers unless
`includeBody` is requested, in which case it waits for completion and returns a bounded optional
body. Arm the wait before the action that causes the request. These bodies may contain sensitive
page data, so the API does not log or persist them. Unlike `networkRequests()` body enrichment,
this wait can return a body for browser pages, boards, and `window.screen`.
## Link Open Menu Helper

`appendLinkOpenMenuItems()` in `src/renderer/editors/shared/link-open-menu.ts` is a reusable function that appends "Open in..." browser menu items to a `MenuItem[]` array. It generates items for: OS default browser, internal browser, all configured user profiles, and incognito. Used by Link Editor (list, tiles, pinned links) and Markdown Preview link context menus.

Additionally, `LinkViewModel.onGetLinkMenuItems` is an optional callback that allows the host (e.g., browser editor) to inject custom menu items at the top of the link context menu. Items returned by this callback are prepended before the "Edit" item with a separator.

## Common Pitfalls

1. **Never update `state.url` from navigation events.** Only update it from user-initiated `model.navigate()`. Use the `model.tabs.currentUrls` map for tracking the actual URL per internal tab.

2. **The webview's `src` attribute is set once at creation.** The initial URL is assigned when `BrowserWebviewItemView` constructs the element. Subsequent navigations use `webview.loadURL()` from `BrowserWebviewModel.navigateWebview()`, gated by `webviewReady`.

3. **Keep IPC registration separate from URL projection.** URL changes must not tear down the `dom-ready` registration or clear `webviewReady`; doing so breaks subsequent navigations.

4. **Call `loadURL()` only after dom-ready.** New tabs created via `addTab(url)` must wait for the webview to fire `dom-ready` before `loadURL()` is called. The `webviewReady` Set tracks this.

5. **Favicon requires PageTab subscription.** `PageTab` must include favicon in its state selector (via `_iconHint`) or it won't re-render when the favicon changes.

6. **The preload script runs in an isolated context.** It shares the DOM with the page but not JavaScript objects. Page scripts cannot access or interfere with the preload's `ipcRenderer` or `MutationObserver`.

7. **Registration/unregistration lifecycle.** The webview registers with the main process on `dom-ready` (when `getWebContentsId()` is available) and unregisters on cleanup. The main process also cleans up if the webContents or sender is destroyed. **Every listener attached inside `registerWebview` MUST go through the local tracked `on()` helper** — `dom-ready` fires on every document load, so `registerWebview` re-runs many times per tab, and only tracked listeners are removed by the `unregisterWebview()` call at the top. A listener attached directly with `wc.on(...)` stacks one copy per navigation (this is what used to trip `MaxListenersExceededWarning`).

8. **Webview background color.** Sites that don't set an explicit background rely on the browser default (white). The webview uses dynamic background: `color.background.default` for blank/new tabs (matching the app theme), switching to `#ffffff` once the user navigates to a real page.

9. **Emotion `&` selector in nested rules.** In Emotion's object syntax, `&` always resolves to the root styled component's class. Inside nested selectors like `"& .tab-close"`, a child rule `".tab-item:hover &"` would generate `.tab-item:hover .ROOT` — not `.tab-item:hover .tab-close`. Always define hover-reveal rules at the parent level: `"& .tab-item": { "&:hover .tab-close": { opacity: 1 } }`.

10. **DRM / Widevine CDM.** The app uses [Castlabs Electron (ECS)](https://github.com/castlabs/electron-releases) — a fork with Widevine DRM support. At startup, `components.whenReady()` in `main-setup.ts` ensures the CDM is downloaded. Production builds require VMP signing via Castlabs EVS (`scripts/vmp-sign.mjs`). Without VMP signing, DRM works on test pages but not on Netflix/Disney+.

11. **MCP navigation waits use main-process lifecycle events.** Arm the navigation waiter before triggering navigation, then await `load`, `domcontentloaded`, or `networkidle`. Do not replace the event waiter with renderer `readyState` polling; see Browser Automation above.
