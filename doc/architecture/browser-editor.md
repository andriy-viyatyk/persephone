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

`BrowserEditor` coordinates editor-level restore/persistence, profile presentation, navigation
normalization, keyboard shortcuts, and popup policy while composing focused submodels:

- `BrowserTabsModel` owns internal-tab lifecycle, committed URL and favicon state, active-tab history,
  and mute/panel operations. `BrowserBookmarksModel` owns the bookmark resource lifecycle and UI.
- `BrowserEditor` owns the resolved Electron session partition and its stable incognito/Tor IDs,
  composes the focused feature models, and fans tab release out to each owner.
- `BrowserTorModel` owns proxy arming, Tor listeners and reconnect lifecycle, and window-close cleanup.
- `BrowserWebviewModel` owns the private guest registry, readiness and navigation commands, and routes
  guest events to `BrowserSiteExtensionController`, `BrowserPageRemote`, `BrowserFindModel`, and
  `BrowserTranslationController` in lifecycle order. Those models own site-extension injection and
  actions, page-authored AiVision/WebMCP registration and requests, find-in-page state, and translation
  workflow plus per-tab translation respectively.
- `BrowserUrlBarModel`, `BrowserBookmarksModel`, `BrowserSitePermissionsModel`, and
  `BrowserTargetModel` own URL-bar state, bookmarks, site-permission/certificate actions, and
  automation respectively. `resolveBrowserProfile()` centralizes the resolved profile, color, and
  bookmark-file read/write target.
- `BrowserPromptsModel` owns transient blocked-popup and permission-prompt state and actions; the
  prompt views render that slice alongside their other browser state.

The host's tab and Tor methods are compatibility forwarding points; the corresponding submodels own
those behaviors and their cleanup. Views use the composed models, while the browser page retains its
existing facade and IPC contracts.

`BrowserEditor.createNew(options)` configures a browser editor, applies the initial navigation,
restores its models, and returns either the ready editor or a refusal. It disposes the partially
constructed editor on refusal. `browser-pages.ts` reports refusals and adds successful editors to
the page collection; the browser chunk remains behind the pages model's dynamic import.

### Browser toolbar order

`BrowserToolbarView` spells out its left-to-right DOM order in one append operation:
Home, Back, Forward, Reload, URL bar, Bookmarks, Tor info, Downloads, Page Menu, DevTools,
and Close Tab. Inside the URL bar's end slot the order is Navigate, Site actions, Translate, and
the bookmark star; Site actions sits there because its actions belong to the current site. The `controls` array may retain a different construction/index order because
`sync()` updates those views positionally; changing the visual order must not silently change
those indexes. The Tor-info control remains in the DOM when Tor is inactive but is hidden and
zero-sized, preserving the same layout contract in both modes.

### Site extension actions

The site runtime retains action handlers in its main world and publishes bounded metadata over the
existing AiVision binding. Main forwards execution-context identity; browser webview state accepts
only the current main-frame context for a tracked, trusted injected document. Publication during
injection is held until evaluation succeeds. Navigation, reload, tab closure, disposal and trust
changes invalidate the state. The toolbar and browser facade share the same run and choice paths;
result validation happens before dispatch to existing editors. A page shares its extension's main
world, so the grant authorizes that page context, not an independently authenticated script.

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

The compact tab hover preview is owned by `BrowserTabsPanel` and displayed through a native
`PopoverView`, which uses the shared `@floating-ui/dom` positioning library.

### Tab Activation History

`BrowserTabsModel` maintains a private `activeTabHistory` stack (array of tab IDs, most recent last). When `switchTab()` or `addTab()` changes the active tab, the previous active tab ID is pushed onto the stack. When `closeTab()` closes the active tab, it pops from the stack to find the most recent still-existing tab to activate, falling back to an adjacent tab if history is empty. The stack is cleaned up when tabs are closed (`closeTab`, `closeOtherTabs`, `closeTabsBelow`).

### Tab Creation and Focus

`BrowserEditor.addTab()` is the editor-level entry point for creating internal tabs. It delegates
tab state to `BrowserTabsModel`, then focuses the URL bar when the new tab is blank
(`about:blank`). The tabs panel's plus row uses this facade so a blank tab added to an existing
browser page receives the same URL-bar focus as the initial blank tab. Tabs opened with a URL keep
focus on the loading webview instead of stealing it for the URL bar.

Address input is normalized by `BrowserEditor.resolveAddressInput()` before navigation or tab
creation: blank input stays blank, Windows drive/UNC paths become `file://` URLs, bare hosts gain
`https://`, and other scheme-less text becomes a URL from the selected search engine. The resolver
also records search history. Browser page creation and `openUrlInBrowserTab()` use this same
resolver, so script- or MCP-supplied search text follows the same path as text entered in the URL
bar.

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

Each materialized internal tab has its own `<webview>` element. On session restore, only the active internal tab is materialized; other tabs keep their saved URL, title, favicon, and tab metadata without creating a guest. Activating one of those tabs materializes it, and it remains mounted across later switches so its scroll position, form data, and session survive. Tabs created during the current session are materialized immediately. Only the active tab's webview is visible (`display` vs `display: none`).

`BrowserTabsModel` owns the runtime-only materialized-ID set. `BrowserEditorView.sync()` passes only those IDs to `PageManagerView`, while retaining tab order. Closing a tab removes its ID; an active-tab fallback is materialized as part of the transition. State-only operations such as reading tab metadata or closing an unloaded tab do not create a guest. An allowed automation operation that targets an unloaded tab explicitly materializes it and waits for its `dom-ready` registration mark, with a bounded timeout, before issuing guest work. This path does not switch the visible tab and still runs after the existing browser access checks.

### PageManagerView (Native Placeholder DOM Stability)

Webview elements are hosted by the native `PageManagerView` (`src/renderer/components/page-manager/`).
It owns imperatively-created placeholder divs, appends new placeholders, and mounts one native
`BrowserTabPageView` per materialized tab. Each page view owns its `BrowserWebviewItemView` and blank
page overlay. Existing placeholders are retained as tabs change or reorder, preserving each webview
and its guest renderer process.

### Webview View Identity

`BrowserWebviewItemView` creates and retains its webview in `onMount`. `BrowserTabPageView` updates
the tab projection through `sync()` and the child's `onUpdate()` while preserving the same webview
element. The blank-page overlay is an owned conditional child, released when the tab is no longer
blank. The item view releases its listeners, readiness state, and main-process registration when it
is disposed.

### dom-ready Gating

The `BrowserEditor.navigate()` command forwards active-tab URL requests to
`BrowserWebviewModel.load()`. The model calls `loadURL()` only when the registered webview
has reached its `dom-ready` state. Automation readiness waiters are separate: they resolve after the
guest is registered with main, or after a bounded timeout, so a targeted background tab can be used
without activating it.

### IPC Registration

`BrowserWebviewItemView` attaches and detaches each webview through `BrowserWebviewModel`. The model
owns the `dom-ready` listener and registration lifecycle; `BrowserGuestChannel` owns the registration
key `${editorId}/${internalTabId}` and is the renderer's browser IPC path. Detaching removes the
listener and unregisters the guest. Main also removes registrations when the webContents or sender is
destroyed. URL projection changes preserve the view and its readiness state.

The guest preload sends `GuestMessage` values from the shared IPC union over Electron's existing
`ipc-message` event. `BrowserWebviewModel` handles that union exhaustively. The guest transport does
not add a request correlator or a separate response envelope.

## Data Flow

### 1. User navigates (types URL + Enter)

```
BrowserEditor navigation command
  -> BrowserWebviewModel.load(activeTabId, url)
  -> if the registered webview is dom-ready, webview.loadURL(url)
  -> main receives webContents navigation events and sends BrowserChannel.event
  -> BrowserWebviewModel.commitNavigation stores the committed URL on the tab
```

### 2. Navigation events (page loaded, redirected)

```
webContents events (main)          IPC                    Renderer
 did-navigate (url)       →  BrowserChannel  → BrowserWebviewModel.commitNavigation
                              .event              → update tab.url and tab metadata
                                                  → URL bar reads committed active-tab URL
```

**Navigation state:** `BrowserTabData.url` stores the committed URL. `BrowserEditor.navigate()` is an
explicit command that asks `BrowserWebviewModel` to load a URL; navigation events commit the observed
URL to the tab. The URL bar and page summary read the active tab, so there is no top-level URL mirror
to go stale.

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

### In-page translation

The Browser toolbar's Translate action is backed by the trusted `text.translate@1` service. The
renderer reads a bounded sample from the original document to choose a source language and the
configured target, then the guest preload's page translation agent reports text units from the
top frame and child frames. The host scheduler prioritizes visible and nearby units, batches
requests within fixed item and character limits, and sends results back to the originating frame.
Frame/document scopes and per-unit revisions prevent stale results from being applied after a
navigation or page mutation.

The guest agent retains original text while rendering translations, observes subsequent DOM
changes, and restores originals when translation stops. Translation work is performed by the
trusted provider through the module-service channel; page text is not sent to a remote browser
translation endpoint by the Browser editor. Cross-document navigation clears the translated state
for that tab.

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
| `selectionText` present | Copy (uses the renderer's main-process clipboard helper) |
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
- **Show Resources:** Combines links extracted from that DOM with the network log and loaded font URLs. `BrowserChannel.collectLoadedResources` reads each frame's Resource Timing entries in the main process, including cache hits and requests made before tab registration; destroyed or navigating frames are skipped. The browser's finite timing buffers can limit the results. DOM favicons use image thumbnails and the image viewer; media links target the video viewer, which also plays audio.
- **Copy for selections:** Uses the renderer's helper, which writes through main-process IPC, instead of `webview.copy()` because the webview loses focus when the popup menu opens. Renderer-owned writes should use the native path for focus independence and compatibility with other history tools; see [Clipboard writes](../standards/coding-style.md#clipboard-writes). Native webview editing commands, including a page's own Ctrl+C, are still captured by the clipboard watcher: Chromium owns those writes through Electron's main-process pid, which the watcher trusts only for its `CanIncludeInClipboardHistory` marker. Its explicit `ExcludeClipboardContentFromMonitorProcessing` marker remains authoritative.
- **Popup dismissal:** Webview clicks don't bubble to the renderer DOM. A transparent overlay (`webview-click-overlay`) is rendered over the webview area while a popup menu is open, allowing clicks to reach the renderer's `document` and trigger the popup's dismiss handler.
- **skipInspect:** The browser context menu provides its own "Inspect Element" item, so `showAppPopupMenu` is called with `{ skipInspect: true }` to suppress the app's default "Inspect" item.

## Browser Panel Host

The browser editor mounts a native `SecondaryViewsView` inside both `BlankPageLinksView`
(empty-page bookmarks overlay) and `BookmarksDrawerView`. To do this without a `PageModel`,
`BrowserPanelHost` implements the `IPageHost` interface that `SecondaryViewsView` requires.

**Key design points:**
- `BrowserPanelHost` is **not** a `PageModel` — it has no tab identity or page lifecycle. It lives only for the lifetime of the browser editor that created it.
- `sidebarMandatory` is permanently `true`. The bookmarks panel can never be closed via the ✕ button or toggle.
- `mainEditor` returns the bookmarks `LinkEditor`, so `linkEditor.isMain === true` — this satisfies `isMain`-gated features (e.g., showing save affordances).
- The optional main-editor-navigation members of `IPageHost` (`switchMainEditor`, `promoteToMain`) are **omitted** — there is no main-editor navigation in the browser panel context.
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
| `src/renderer/editors/browser/BrowserEditorView.ts`, `BrowserToolbarView.ts`, `BrowserWebviewItemView.ts`, `BrowserPromptBars.ts`, `SitePermissionsPopover.ts`, `PageZoomPopover.ts` | Renderer | Browser UI composition split across focused views |
| `src/renderer/editors/browser/BrowserEditor.ts` | Renderer | Editor coordinator: restore/persistence, navigation normalization, profile presentation, keyboard shortcuts, and composed sub-model lifecycle |
| `src/renderer/editors/browser/BrowserTabsModel.ts` | Renderer | Internal-tab lifecycle, committed URL and favicon caches, mute/panel operations |
| `src/renderer/editors/browser/BrowserBookmarksModel.ts` | Renderer | Bookmark resource lifecycle and UI actions |
| `src/renderer/editors/browser/browser-profile.ts` | Renderer | Profile, color, and bookmark-file resolution |
| `src/renderer/editors/browser/BrowserSitePermissionsModel.ts` | Renderer | Site permissions and certificate actions |
| `src/renderer/editors/browser/BrowserGuestChannel.ts` | Renderer | Browser guest IPC and registration keys |
| `src/renderer/editors/browser/browser-state.ts` | Renderer | Browser state/defaults, tab/group IDs, title policy, and partition string helper |
| `src/renderer/editors/browser/search-engines.ts` | Renderer | Search-engine definitions and URL detection |
| `src/renderer/editors/browser/BrowserTorModel.ts` | Renderer | Tor proxy arming, daemon listeners/reconnect, and cleanup |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Renderer | Private webview registry, readiness and navigation commands, guest event routing |
| `src/renderer/editors/browser/BrowserSiteExtensionController.ts` | Renderer | Site-extension trust, injection, actions, fetch routing, and reload lifecycle |
| `src/renderer/editors/browser/BrowserPageRemote.ts` | Renderer | Page/WebMCP model registration, probing, privacy checks, revalidation, and remote requests |
| `src/renderer/editors/browser/BrowserFindModel.ts` | Renderer | Find-in-page state and commands |
| `src/renderer/editors/browser/BrowserPromptsModel.ts` | Renderer | Transient blocked-popup and permission-prompt state and actions |
| `src/renderer/editors/browser/BrowserTranslationController.ts` | Renderer | Translation toolbar workflow and per-tab page translation lifecycle |
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
| `src/main/browser-service.ts` | Main | Browser service composition and IPC-facing methods |
| `src/main/browser/BrowserGuest.ts`, `BrowserGuestRegistry.ts` | Main | Per-registration guest listeners, state, disposal, and lookup |
| `src/main/browser-dom-snapshot.ts` | Main | DOM and loaded-resource collection, including iframe content |
| `src/main/host-fullscreen-controller.ts` | Main | Per-window host fullscreen intent and registered-guest coordination |
| `src/main/cdp-service.ts` | Main | CDP service composition and app, board, and browser target routing |
| `src/main/cdp/CdpTarget.ts` and feature modules | Main | Per-WebContents debugger state and page-event, wait, network, drag, and AiVision owners |
| `src/main/network-logger.ts` | Main | Per-page HTTP request/response logging via `session.webRequest`, circular buffer, IPC access |
| `src/main/tor-service.ts` | Main | Tor process lifecycle: spawn/kill tor.exe, restart, per-partition SOCKS5 proxy (armed before the daemon starts so the partition fails closed), torrc generation, exit-IP lookup |
| `src/main/tor-src-protocol.ts` | Main | `tor-src://` handler — fetches an `http(s)` URL through a Tor partition's session |
| `src/main/session-proxy.ts` | Main | Shared session proxy primitives (apply one proxy with no fallback, set direct, geo lookup) used by Tor and profile networks |
| `src/main/browser-network-service.ts` | Main | Profile/Incognito proxy state, `profile-src://` handler, guest WebRTC policy, egress check, `session-src` hand-off |
| `src/ipc/browser-network-ipc.ts` | Shared | `BrowserNetwork` type, endpoint validation, `browser-network:*` channels |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` | Renderer | Per-page profile network: apply before mount, follow settings edits, image route for app-drawn resources |
| `src/renderer/editors/link-editor/routed-src.ts` | Renderer | `ImageRoute` + `resolveRoutedSrc` — rewrites remote `src` values to `tor-src://` or `profile-src://` for a routed page |
| `src/renderer/ui/dialogs/TorInfoDialog.ts` | Renderer | Connection info for a routed page: Tor (exit IP, location, Reconnect) or proxy (egress IP, location) |
| `src/preload-webview.ts` | Guest | Main-frame browser behavior, page-first keyboard handling, title/favicon reporting, image tracking, and the `window.chrome` compatibility shim; installs cinema mode in every preloaded frame |
| `src/preload-webview/cinema-mode.ts` | Guest | Per-frame cinema runtime, video discovery and controls, iframe-chain messaging, expansion/restoration, and same-origin assisted video support |
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

The main process owns navigation policy as well as event forwarding. Page-initiated navigation to
`file:` and `app-asset:` is denied; other non-Chromium schemes, including Persephone's internal
schemes, are prevented from navigating the page and are handed to the host only after a recent user
activation, where only a registered board claim can consume them. App-initiated navigation such as
restoring a local page is separate from page-initiated navigation. Popup windows receive their own
guards: they cannot navigate to local files or non-Chromium schemes, and a popup that enables Node
integration is destroyed.

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

Cinema mode is implemented by `src/preload-webview/cinema-mode.ts` and installed outside the
`process.isMainFrame` guard in `src/preload-webview.ts`. It therefore runs in each frame where
Electron executes the webview preload (`nodeIntegrationInSubFrames` is enabled by
`browser-service.ts`). The rest of the browser preload, including find-bar keyboard handling,
remains main-frame-only.

Each runtime discovers videos in its document and uses capture-phase pointer-position hit-testing
to find the largest eligible video under the pointer. This works when a player overlays the video
with its own controls. The button uses DOM-created SVG (not `innerHTML`) and stays in the frame
containing the video. Video attachment retries on playback and resize for players that initially
report a zero-sized video. A scoped document mutation observer attaches to dynamically inserted
videos; broad shadow-root video discovery is not performed.

Entering cinema mode saves that frame's original inline styles, sibling visibility, document
overflow, and active marker. It expands the video’s composed ancestor chain, hides siblings with
`visibility: hidden`, adds the black backdrop under `<html>`, and dispatches `resize`. An iframe
target and its composed ancestors receive full-viewport declarations, including a borderless frame.
An iframe-scoped style observer reapplies those declarations when the site rewrites styles, and a
child-list observer plus the iframe's `load` event releases the expansion if the frame is removed
or navigates. Cleanup disconnects observers and restores saved state in reverse order before
dispatching another resize.

Frames coordinate with a versioned `persephone:cinema` `postMessage` payload. A child enter is
accepted only when its source matches a direct child iframe; lookup also searches open shadow roots
for direct iframe children. Each frame expands only its own local target and forwards the session
upward. Exit messages are constrained to the active session and the corresponding child or direct
parent, so a stale message cannot close a newer session. Escape in a frame with cinema state exits
the chain through the same protocol. In the main frame, the existing keyboard handler first asks
cinema mode to exit, then preserves the page-first unclaimed-Escape behavior. With no cinema state,
subframe key handling does not add a browser shortcut handler.

For a same-origin child iframe where Electron does not run the preload on the webview's initial
page, the parent detects the missing runtime marker and assists that child. It listens for pointer
movement in the child document, displays the button in the parent, expands the iframe, and applies
the video fill fallback in the child's document. It retains native controls while active and adds
a child-document Escape listener; exit, removal, and navigation restore the video's prior style
and controls and remove the listener. Cross-origin children without a running preload cannot be
assisted because their DOM is inaccessible.

Plain videos are left to the site's own resize behavior first. If a video still occupies less than
90% of the viewport width and height 300 ms after entry (and after subsequent resizes), cinema mode
sets it to a viewport-sized `object-fit: contain` fallback and restores its original inline style
on exit. Video controls are enabled and observed while active, then restored to their prior state.

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

## User-Agent

Browser pages present Chrome's own User-Agent: `toChromeUserAgent()` (`src/main/browser-service.ts`)
removes the `persephone/x` and `Electron/x` tokens and reduces the version to
`Chrome/<major>.0.0.0`, as Chrome's User-Agent reduction does. It is applied in two places, and both
are required:

- `initBrowserUserAgent()` sets `app.userAgentFallback`. `setupMainProcess()` calls it before any
  renderer starts. A cross-origin iframe runs in its own renderer process and reads this fallback,
  not the session's UA.
- `cleanUserAgent(ses)` calls `session.setUserAgent()` for each browser session, which covers top-level
  navigations and the HTTP `User-Agent` header.

With only the session UA cleaned, a page claims Chrome while its cross-origin iframes report
Electron. Cloudflare's challenge frame (`challenges.cloudflare.com`) sees the mismatch and
re-challenges forever. Persephone's own window reports the same string. Client Hints
brands (`navigator.userAgentData`) stay Electron's `Chromium` brands; no Electron API changes them,
and the challenge passes without it.

## Session Restore

`getRestoreData()` saves each internal tab with its committed URL. Navigation events update `tab.url` directly, so restore data and the active-tab summary do not depend on a separate current-URL map or top-level URL mirror. `applyRestoreData()` restores them with fresh internal tab IDs and ensures each tab has a `groupId` (assigning a new one if missing for backward compatibility). The active tab is identified by index position during restore and is the only restored tab initially materialized; other tabs retain saved URL, title, favicon, and settings until activation or explicit guest automation access. Transient loading, audible, and back/forward flags reset on restore because they describe live guest state. Mute intent and zoom are retained and applied when a guest is created. Profile name, incognito flag, and Tor flag are also saved/restored.

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

`getPartitionString()` in `browser-state.ts` computes the partition. `BrowserEditor.partition` is the shared getter because profile state may be set after editor construction in `showBrowserPage()`. Each editor has stable incognito/Tor IDs (random UUIDs generated once per instance) to keep the partition consistent across getter calls. `BrowserTorModel` reads this resolved partition and owns Tor lifecycle only.

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

Window recording has a narrow exception in the app renderer session: main arms a short-lived,
one-shot grant for the requesting `webContents` when it issues that window's desktop source id.
Only the matching main-frame video permission request is allowed, including Electron's empty
`mediaTypes` shape for desktop capture; audio remains disallowed. The corresponding permission
check accepts video only while the grant is armed, and display-capture requests remain denied.

Voice Typing has a separate short-lived, one-shot grant for audio capture. It is armed for the app
renderer `webContents` only after a trusted transcription provider is found, and the permission
request must be main-frame audio-only. The grant is consumed by that request and cleared on expiry,
failure, cancellation, or window teardown; it does not authorize audio from app subframes, boards,
or browser sessions. The video-recording grant remains video-only.

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
its internal tab, and `BrowserPromptBars` shows the permission bar for the active tab. Allow and Block
send only the opaque request ID and decision back over `BrowserGuestChannel.resolvePermissionRequest` (which invokes `BrowserChannel.resolvePermissionRequest`);
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
appears in Settings → Browser → Browser Profiles.

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

`resolveBrowserProfile(state)` resolves the selected or default profile and its color, falling back to `DEFAULT_BROWSER_COLOR`. Tor and Incognito icons are selected before profile color is used.

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
point, rather than a check duplicated across `navigate`, `addTab`, and the URL bar.

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
  gates the `requestFaviconSave` call sites, and `BrowserEditorView`/`BrowserBookmarksModel` skip the
  save for Tor and incognito. The marker set behind `requestFaviconSave` is module-level and shared
  by every browser page, so a marker armed from a private page would otherwise be honoured later by
  another one. A proxied profile is persistent, so it does save favicons, but downloads them with
  renderer `fetch()` through its `profile-src://` route (`routedFetchUrl`) instead of Node `https`.
- **Opening a resource out of the page.** "Open Image in New Tab" asks main for a one-URL
  `session-src` handle (`browser-network:session-source`) and opens the image through it; the image
  editor then shows the bytes, not the URL. A routed page whose route is down opens nothing.
  Board-claimed downloads get a board-bound `session-src` handle for proxied persistent sessions as
  they do for Tor and incognito ones. The handle carries the board's granted network policy, and
  main validates permission and pins resolved addresses on every redirect hop.
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
  mounts **no webview** — `BrowserEditorView` passes an empty page list to the page manager and shows
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

Pages transiently owned by a board's Run action are excluded from both internal- and external-link
searches. They are opened through the board page lifecycle using
`persephone.openRawLink(url, { editor: "browser-view", reuseKey })`, which scopes reuse to the
board root and key. Reopening the same URL hard-reloads the active Browser tab so regenerated local
HTML is picked up; changing the URL navigates the owned page instead. URL identity is case
sensitive for web paths and queries, while scheme and host are normalized for comparison (and file
URL paths are case folded).

### Markdown Link Context Menu

Right-clicking a link in Markdown Preview shows additional items for external URLs (http/https) via the shared `appendLinkOpenMenuItems()` helper:
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
    └─ BrowserBookmarksModel
        └─ BrowserBookmarks
            ├─ TextFileModel — file I/O, encryption, FileWatcher, auto-save
            └─ LinkEditor   — parsed link data, categories, tags, filters
```

`BrowserBookmarksModel` owns the bookmark resource, delayed preload timer, interactive initialization,
UI actions, and disposal. `BrowserBookmarks` wraps the file and structured-data models. `TextFileModel`
handles reading/writing the `.link.json` file (including encryption/decryption), while `LinkEditor`
provides the structured data layer. Every mutation flows through `LinkEditor.onDataChanged()` to
`TextFileModel.changeContent()` and its debounced save.

### Initialization Flow

Bookmarks load through two paths:

**Eager preload (silent):** `BrowserBookmarksModel` schedules `preloadBookmarks()` after a 300ms delay.
It resolves the file through `resolveBrowserProfile(state)` and calls
`BrowserBookmarks.init({ silent: true })`, which skips the password dialog for encrypted files. If
successful, bookmarks appear immediately on blank tabs. If encrypted, bookmarks remain unloaded until
the user triggers initialization.

**Manual trigger (interactive):** User clicks the star or "Open Links"; `BrowserBookmarksModel` checks
its resource and the resolved bookmark-file path. If no path exists, it shows the "Associate Bookmarks
File" dialog. It then creates `BrowserBookmarks(filePath)` and initializes it with a password dialog
when needed. `resolveBrowserProfile(state).setBookmarksFile(path)` persists the selected path to the
same setting or profile that supplied it.

After initialization, `BrowserBookmarksModel` configures two callbacks on `linkModel`:
- `onLinkOpen` modifies the link event data before it enters the `openRawLink` pipeline: sets
  `target: "browser"` and `metadata.browserPageId` to the owning browser page. The HTTP resolver's
  browser branch then routes the URL to that page (navigating a blank active tab or adding a new tab).
- `onGetLinkMenuItems` returns an "Open in New Tab" menu item that calls `BrowserEditor.addTab(url)`.
  These items are prepended to the link context menu (before "Edit").

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

When focus is inside a `<webview>`, keyboard events are consumed by the guest page and never reach the renderer's DOM. `BrowserGuest` intercepts these via `webContents.on("before-input-event")`, handling F5, Ctrl+R, F12, and Alt+Left/Right directly on the webContents. Escape is intercepted there only while that webview is in HTML fullscreen; otherwise it reaches the guest page and the preload handles it after the page has had a chance to claim it.

### Layer 2: Global Key Event Bus (`globalKeyDown` Subscription)

When focus is on any renderer element (toolbar, URL bar, tab panel, or no specific focus), the browser editor subscribes to a global keyboard event bus. `MainPageView` broadcasts all `keydown` events via `globalKeyDown.send(e)` (defined in `events.ts`). `BrowserEditor` subscribes in its constructor and handles browser hotkeys only when it's the active page. This keeps browser-specific logic out of the shell composition view.

### Layer 3: Browser shortcut table (`BrowserEditor`)

The browser shortcut table handles `Ctrl+L` (focus URL bar) and `Ctrl+F` (find in page) — shortcuts specific to the browser UI that don't need global reach. This layer covers focus on Persephone's own chrome; `Ctrl+F` with focus *inside* the page is decided by the guest preload instead (see below).

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
presses. Find-bar handling is inside the main-frame-only preload guard, so `Ctrl+F` with focus
inside an iframe reaches that frame and stops there rather than opening the find bar.

When cinema state is active, Escape exits it before the ordinary page-first Escape path. The
focused subframe handles its own Escape and routes the session exit through the cinema message
protocol; the main frame uses its existing key handler. With no cinema state, ordinary Escape
keeps the deferred page-first behavior: the preload runs `window.stop()` and sends `hide-find-bar`
only when the page left it unclaimed. In HTML fullscreen, the main process takes Escape before
guest dispatch and asks the page to exit fullscreen; the page's own fullscreen event also clears
the view state when the user uses its fullscreen controls.

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
`BrowserChannel.exitHtmlFullscreen`. `BrowserGuest` owns the guest's fullscreen state and transition
listeners. The `HostFullscreenController` owned by each `OpenWindow` tracks host fullscreen intent
and coordinates all registered guests in that window; it restores the host window only after no
guest needs fullscreen and no host fullscreen intent remains. Unregistering a fullscreen guest also
reconciles host state. Escape requests the same exit while HTML fullscreen is active, whether focus
is in the guest or Persephone chrome.
Window bounds are not persisted during fullscreen, avoiding restoration of the display-sized bounds
as a normal window on the next launch.

`BrowserGuest` tracks the last mouse press for its registration. If focus leaves the guest, its host
window blurs, or the press opens a new tab or popup before the matching mouse-up reaches the page,
the guest sends a mouse-up at the last pointer position. This prevents the page from retaining a
pressed-button state after the release was routed elsewhere.

The scripting facade exposes guest HTML fullscreen through
`pages[pageId].editor.fullscreen(selector?, { tabId? })` and `exitFullscreen({ tabId? })`. These
methods use the active internal tab by default and retain the browser page's private-page access
checks. Without a selector, main inspects the guest main frame and descendant frames, preferring a
visible playing video and then the largest frame-local visible area; traversal and DOM order break
ties. A selector searches only the main frame and chooses the largest visible match. The selected
frame makes the fullscreen request with Electron's user-gesture flag, and the operation awaits the
guest transition and returns `{ fullscreen }`. A page's iframe permissions policy can still reject
the request; callers can use browser automation to click the site's own fullscreen button.

Host fullscreen is tracked separately from guest HTML fullscreen. `app.window.getFullScreen()`
reports the actual native window state, while the browser methods report guest HTML fullscreen.
`setFullScreen(false)` exits both, while an explicit host fullscreen request survives guest exit.
Moving a window first exits guest fullscreen, relocates the native window, and re-requests the
previously fullscreen video in its guest; `moveToDisplay()` reports the final native display,
bounds, maximize intent, and fullscreen state. Display indexes are positions in a fresh
`getDisplays()` snapshot, and geometry is expressed in Electron DIP coordinates. The request path
is implemented, but gesture and iframe behavior still requires verification in the pinned Castlabs
runtime.

### Reload and the `beforeunload` guard

A guest page with a `beforeunload` handler (e.g. an unsaved-changes guard) tries to cancel any reload/navigation. Electron's default for the resulting `will-prevent-unload` event is to **silently cancel the unload** — no prompt, no reload — which makes Reload/F5 appear dead. `BrowserGuest` handles `will-prevent-unload` to fix this:

- **Soft reload** (toolbar button, `F5`, `Ctrl+R`) → a native confirm ("You have unsaved changes. Leave the page and discard them?"); **Leave** allows the unload (reload proceeds), **Cancel** keeps the page.
- **Hard reload** (`Ctrl+F5` / `Ctrl+Shift+R`) → bypasses the prompt and force-reloads.

The bypass uses a one-shot `bypassUnloadGuard` flag on the per-registration `BrowserGuest`: armed by a hard reload, consumed (and cleared) by the `will-prevent-unload` handler, and cleared defensively on `did-stop-loading` so it can never leak to a later reload. Because the flag lives in the main process, both keyboard layers must arm it there:

- **Layer 1** (`before-input-event`, focus inside the page) arms the guest's bypass flag and calls `reloadIgnoringCache()` directly.
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
`BrowserPageRemote` probes `window.__aiVision` and the app-owned WebMCP remote unless the existing
privacy gate refuses the page. A valid serialized shape is retained per internal tab and document
generation; `BrowserEditorFacade` mounts it through `createRemoteProxy` only for the active tab. A
navigation, reload, tab switch, close, or model disposal invalidates that binding, so a prior
document cannot answer a request for a new one. The proxy revalidates the live remote version
through CDP before each request, so lazy revalidation remains correct even if a signal is missed.
For a registered model, the probe also installs the package's `Runtime.addBinding` host signal. The
main CDP service listens only for that binding's `Runtime.bindingCalled` message and routes it over
the browser IPC event channel; a shape signal triggers a background re-probe, while a page
`notify(text)` becomes a rate-limited, page-attributed event. WebMCP emits shape signals only.

WebMCP is enabled by the main process before guest startup: `will-attach-webview` adds an app-owned
preload argument only for persistent `browser-*` profile partitions. Incognito, Tor, and other
partitions do not receive it. In an eligible secure document, `preload-webview.ts` preserves a
native `document.modelContext` if present, or installs the imperative compatibility API in the
main world at document start. It also keeps a non-enumerable host remote for shape discovery and
dispatch; the page API is `document.modelContext` (with a compatibility `navigator.modelContext`
getter).

WebMCP tools join the existing `.app` descriptor only while at least one valid tool is registered.
With no `window.__aiVision` model, tool methods appear directly under `pages[i].editor.app`. When a
page or trusted site extension provides `window.__aiVision`, its members remain intact and WebMCP
appears under an unused `webmcp` namespace (for example `webmcp_2` if the page already owns that
name). Tool names that are not valid member identifiers are mapped to safe names with deterministic
numeric suffixes for collisions; calls still dispatch by the original WebMCP name. The JSON Schema
is reduced to a bounded, single-object-argument signature. Consequential tools, tools without
`readOnlyHint: true`, and tools marked with `untrustedContentHint` carry the corresponding caution
in the descriptor. Tool descriptions and returned values are site-provided data and must never be
treated as instructions.

Registration, abort, and late `toolchange` events refresh the shape. Removing the last WebMCP tool
removes its contribution, including the `.app` node when no independent page model remains. Calls
use `document.modelContext.getTools()` / `executeTool()` through the WebMCP remote, share the
existing timeout policy, and are rejected when the active tab, document, or source version has
changed. Removing a WebMCP contribution does not create a `shape-changed` event-log entry; an
independent page model remains available. JSON-serialized results are decoded when valid; otherwise
the original string is returned.
The proxy sender invokes the selected page remote through CDP and labels the page-authored subtree
as data. The `.app` subtree does not contribute to the page or `pages` overview descriptors.

The URL bar's Site permissions control indicates when the active regular page has a live model
registration: green identifies a page-published model and blue identifies a model after a trusted
site extension was successfully injected into the same document. The popover repeats that source
in a badge above the origin. `BrowserPageRemote` keeps registrations private and emits a change
subscription so the toolbar and an open popover refresh; neither the subscription state nor
registration data is persisted. `BrowserSiteExtensionController` retains the injected extension
name with the document id, clearing it on navigation, successful in-place extension teardown, tab
removal, and disposal. The view combines that marker with a live registration and suppresses the
indicator in Incognito and Tor modes. A trust grant, prompt, or failed injection alone is not evidence
that a model came from an extension.

The same site-info popover offers certificate viewing for HTTPS pages. `BrowserEditor.getCertificate()`
uses the active or requested internal tab's current URL and asks that tab's existing
`CdpSession` for `Network.getCertificate` with the URL origin. It returns the current URL and
Chromium's base64 DER certificate chain in leaf-first order; non-HTTPS tabs and empty Chromium
results return `undefined`. The browser view passes the tab id it captured when the popover action
started, so a tab switch during retrieval cannot redirect the request to another webview. No
certificate chain is cached or persisted. A restored HTTPS tab may initially have no chain because
Chromium has not yet performed the restored navigation; navigate or reload the tab, then request the
certificate again.

When a `certificate.view` capability handler is available, the popover sends the chain to it. If
there is no handler, the browser opens a PEM bundle in the text editor. See
[`capabilities.md`](capabilities.md#well-known-capability-certificateview) for the capability
payload and validation contract.

### Site extensions

The renderer-side `SiteExtensionStore` reads immediate child folders from the configured
`site-extensions.path`, or defaults to `<userData>/data/site-extensions`. Each extension has a
manifest and a script. The store validates the manifest and exact HTTPS host names, caches the
manifest index against modification time, and reads the script fresh for each injection. If valid
extensions claim the same host, none of those claims is selected for injection. A manifest script
path is resolved relative to its extension folder and rejected when its normalized path leaves that
folder. This is a lexical check; a symlink inside the extension folder can still point outside it,
so this path check is not a filesystem sandbox.

`BrowserSiteExtensionController` checks each completed document's URL and privacy mode before loading an
extension. Incognito and Tor pages are always skipped. A matching extension runs in the page's
main world through CDP `Runtime.evaluate`, with the standalone site-extension runtime loaded before
the extension script; this path is not subject to the site's script CSP. Extensions do not run until
the user trusts them. Trust is owned by the main process and persisted separately from extension
folders. A grant records the extension id and its exact host set, so changing that set requires
consent again. Binding trust to the configured folder means changing the folder clears all grants.
The browser's in-page prompt offers Trust and Not now; Not now suppresses the prompt for that tab
until its next navigation. Trusting evaluates the matching extension in that document immediately.
An agent may trust an extension it built on the user's request and should tell the user. For
downloaded, received, or unknown-origin extensions, the user decides unless they ask the agent to
review the script and trust it for them. Page content cannot authorize trust.
The prompt is document-scoped, so a stale bar cannot grant trust after navigation or extension
changes.

The extension script publishes `window.__aiVision` through the injected runtime's `expose()` API.
The regular page-model probe then registers that shape with the browser editor. `refresh()` signals
the probe again when an extension exposes its model after the initial load probe. Injection is
tracked per document to avoid rerunning on duplicate load events. The `app.siteExtensions` agent
service can scaffold and list extensions, remove one with confirmation, and reload the trusted
extension in the active browser document without reloading the site. In-place reload runs the old
script's registered disposers, clears its remote model, reads the script again, and uses the same
trust, host, enabled, and privacy gates as normal injection. Trust or enabled-state changes do not
remove code already running in an open document; navigate or reload that document to apply them.

The renderer trust mirror receives authoritative snapshots over IPC. The main-process trust service
serializes file mutations and broadcasts updates to every application window. Renderer management
helpers keep folder removal and trust revocation together, while the Tools & Editors hub's Site
extensions tab lists validation status, host conflicts, trust state, and management actions.

## Page zoom

Each internal tab persists its own `zoomPercent` (50–200, default 100). `BrowserEditorView` exposes
the active tab's value through a toolbar button and a popover with a vertical Slider and presets.
The popover wheel and guest keyboard or Ctrl+wheel zoom intents change the value in 5% steps.
`BrowserWebviewModel` updates tab state and sends `BrowserChannel.setZoom`; the main process
validates the value and verifies that the requesting renderer owns the registered guest.

Browser guests use `zoomMode: "isolated"`, so tabs sharing an origin do not share page zoom.
The applied guest zoom factor is the host window's zoom factor multiplied by the tab percentage
divided by 100. Registration applies the stored value, and `reapplyBrowserGuestZoom` reapplies it
after host window zoom changes and Chromium's embedder synchronization. This keeps page zoom
relative to the app window's zoom.

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

The shared resolver in `operations.ts` accepts a CSS selector or snapshot ref. Action operations use
strict actionable resolution: they require one visible match unless a zero-based `{ nth }` selects
among visible matches. Query and read methods use query-mode resolution and do not enforce the same
single-match rule. Before trusted actions it checks attachment, visibility, stability across two
animation-frame measurements (with a bounded timer fallback), enabled state, and hit-testing
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
inputs and contenteditable. For text inputs, selection runs on the resolved element in its own
frame; `clear()` uses the same selection path. Mapped `slowly` characters produce key events; native date/time/color/
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
dispatches DOM work through the session that minted each ref. A snapshot rooted in a frame retains
the host's existing frame-session map; a snapshot that discovers frames replaces that target's map.
Replaced documents/nodes make refs stale, and refs from another host are rejected.
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

1. **Keep tab URLs committed.** `BrowserTabData.url` is updated by navigation events. Use `BrowserEditor.navigate(url)` to request navigation; do not mirror the URL into a separate top-level field.

2. **The webview's `src` attribute is set once at creation.** The initial URL is assigned when `BrowserWebviewItemView` constructs the element. Subsequent navigations use `webview.loadURL()` from `BrowserWebviewModel.load()`, gated by `BrowserWebviewModel.isReady()`.

3. **Keep IPC registration separate from URL projection.** URL changes must not tear down the `dom-ready` registration or clear the readiness state; doing so breaks subsequent navigations.

4. **Call `loadURL()` only after dom-ready.** New tabs created via `addTab(url)` must wait for the webview to fire `dom-ready` before `loadURL()` is called. `BrowserWebviewReadiness` tracks this.

5. **Favicon requires PageTab subscription.** `PageTab` must include favicon in its state selector (via `_iconHint`) or it won't re-render when the favicon changes.

6. **The preload script runs in an isolated context.** It shares the DOM with the page but not JavaScript objects. Page scripts cannot access or interfere with the preload's `ipcRenderer` or `MutationObserver`.

7. **Registration/unregistration lifecycle.** The webview registers with the main process on `dom-ready` (when `getWebContentsId()` is available) and unregisters on cleanup. The main process also cleans up if the webContents or sender is destroyed. **Every listener attached inside `registerWebview` MUST go through the local tracked `on()` helper** — `dom-ready` fires on every document load, so `registerWebview` re-runs many times per tab, and only tracked listeners are removed by the `unregisterWebview()` call at the top. A listener attached directly with `wc.on(...)` stacks one copy per navigation (this is what used to trip `MaxListenersExceededWarning`).

8. **Webview background color.** Sites that don't set an explicit background rely on the browser default (white). The webview uses dynamic background: `color.background.default` for blank/new tabs (matching the app theme), switching to `#ffffff` once the user navigates to a real page.

9. **Browser styles.** Make browser styling changes in the co-located static CSS files under `src/renderer/editors/browser/`.

10. **DRM / Widevine CDM.** The app uses [Castlabs Electron (ECS)](https://github.com/castlabs/electron-releases) — a fork with Widevine DRM support. At startup, `components.whenReady()` in `main-setup.ts` ensures the CDM is downloaded. Production builds require VMP signing via Castlabs EVS (`scripts/vmp-sign.mjs`). Without VMP signing, DRM works on test pages but not on Netflix/Disney+.

11. **MCP navigation waits use main-process lifecycle events.** Arm the navigation waiter before triggering navigation, then await `load`, `domcontentloaded`, or `networkidle`. Do not replace the event waiter with renderer `readyState` polling; see Browser Automation above.

Browser facade automation records successful qualifying operations for an opted-in MCP request
using the selected internal tab's live pre-action URL. The renderer checks HTTPS, the agent-tip
setting, and valid or conflicted extension claims before returning private observations to main.
Paths and queries remain in bounded session memory and are never shown to the agent.

### Site extension cross-host fetch

The manifest's separate `fetchHosts` set is part of the folder-bound grant; legacy grants migrate
to an empty set, and either host set changing requires consent again. The main-world runtime sends
bounded `fetch-request` signals through the existing binding. `BrowserSiteExtensionController`
associates them with the current trusted document and context; the guarded main broker checks the persisted grant
for each HTTPS destination and redirect. It uses cookieless Node fetch, a ten-second deadline,
three redirects, four requests per tab, and an 8 MiB decoded UTF-8 limit. Lifecycle invalidation
cancels requests and discards late results. No DNS filtering or pinning is performed, and the shared
page world can use the extension's granted capability. Trust changes abort outstanding fetches.
