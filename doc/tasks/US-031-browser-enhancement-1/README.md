# US-031: Browser Enhancement #1

## Status

**Status:** Completed
**Priority:** Medium
**Started:** 2026-02-22
**Depends on:** US-029 (Browser Web Page Context Menu)

## Summary

A collection of UX improvements, bug fixes, and new features for the browser editor — including OAuth popup support, toolbar changes, tab panel styling, compact tab tooltips, audio mute controls, home button, and a multi-engine search selector.

## Why

- Authentication flows (e.g., Google OAuth on Reddit) were broken because popup windows opened as internal tabs instead of real windows
- Tab panel UX needed polish — active tab styling, splitter visual weight, compact mode usability
- Tab audio control is a standard browser feature users expect

## Completed Items

### 1. OAuth Popup Window Support
Authentication popup windows (e.g., Google OAuth) now open as real Electron BrowserWindows instead of internal tabs. This preserves the `window.opener` reference required by auth flows.

- **Disposition routing:** `target="_blank"` link clicks (`foreground-tab`/`background-tab`) still open as internal tabs; `window.open()` from JS (`default`/`new-window`) opens as real popup BrowserWindows
- **Popup centering:** Popup windows are centered on the parent js-notepad window (multi-monitor aware) using `BrowserWindow.fromWebContents(sender)` to get parent bounds
- **Features parsing:** `parseFeature()` helper extracts width/height from the `window.open()` features string; defaults to 500x600
- **Session sharing:** Popup inherits the webview's session partition, so cookies and auth state are shared

**Files modified:**
- `src/main/browser-service.ts` — `setWindowOpenHandler` disposition routing, `parseFeature()`, popup centering
- `doc/architecture/browser-editor.md` — Updated "New Window Handling" section

### 2. Toolbar Changes
- Removed duplicate "New Tab" button from the browser toolbar (the tabs panel already has one)
- Added "Close Tab" button as the last toolbar button

**Files modified:**
- `src/renderer/editors/browser/BrowserPageView.tsx` — Replaced PlusIcon with CloseIcon, removed `handleNewTab`, added Close Tab button

### 3. Close Last Tab Behavior
Closing the last internal tab now replaces it with a fresh `about:blank` tab instead of doing nothing.

**Files modified:**
- `src/renderer/editors/browser/BrowserPageModel.ts` — `closeTab()` handles last-tab case

### 4. Active Tab Styling
Changed the active internal browser tab style from a blue selection background to a bordered style:
- Background: `color.background.dark`
- Border: `1px solid color.border.active` (blue)
- Border radius: 4px (with flat right corners when extension popup is shown)

**Files modified:**
- `src/renderer/editors/browser/BrowserTabsPanel.tsx` — Active tab styles, `.extended` class

### 5. Transparent Splitter
The tabs panel / content area splitter is now transparent and positioned absolutely over the content area, so it doesn't add visual width to the tabs panel:
- `position: absolute`, `backgroundColor: transparent`, `zIndex: 2`
- On hover: shows `color.background.light` as a resize indicator
- Tabs panel has its own `borderRight` for a clean visual boundary

**Files modified:**
- `src/renderer/editors/browser/BrowserPageView.tsx` — Splitter override styles, tabs-panel borderRight, browser-body `position: relative`

### 6. Compact Tab Extension Popup
When the tabs panel is minimized to icon-only width, hovering a tab shows a floating extension popup to the right with the tab title and close button:
- Uses `useFloating` from `@floating-ui/react` for positioning
- Seamless connection: tab right corners flatten, extension has flat left corners (`borderRadius: "4px 0 0 4px"` / `"0 4px 4px 0"`)
- Fixed width: 140px
- Hover bridging: 100ms delayed close so mouse can travel between tab and extension
- Matches tab background/border style (light for normal, dark+blue for active)
- Click to switch tab, close button to close tab

**Files modified:**
- `src/renderer/editors/browser/BrowserTabsPanel.tsx` — Full rewrite: `useFloating`, hover state, extension popup, `.tab-extension` styles

### 7. Tab Audio Mute Controls
Two-level audio mute system inspired by Chrome/Firefox tab muting:

**Per-internal-tab mute:**
- Volume icon appears on tabs that are playing audio (or are muted)
- Shown in both normal tabs and compact extension popup
- Click toggles mute for that specific tab

**Page-level mute (js-notepad page tab):**
- Volume icon appears on the browser page tab when any internal tab is audible
- Click toggles mute for ALL internal tabs in that browser page
- Both levels must be unmuted for sound to play (effective mute = `tabMuted || pageMuted`)

**Architecture:**
- Main process listens to `audio-state-changed` on webContents, relays `audible` state to renderer
- Main process handles `setAudioMuted` IPC to mute/unmute webContents
- Model tracks `audible`/`muted` per tab and `pageMuted`/`_anyTabAudible` at page level

**New icons:** `VolumeIcon` (speaker with sound waves), `VolumeMutedIcon` (speaker with X)

**Files modified:**
- `src/ipc/browser-ipc.ts` — `audio-state-changed` event type, `setAudioMuted` channel, `audible` field
- `src/main/browser-service.ts` — `audio-state-changed` event relay, `setAudioMuted` IPC handler
- `src/renderer/editors/browser/BrowserPageModel.ts` — `audible`/`muted` on `BrowserTabData`, `pageMuted`/`_anyTabAudible` on state, `toggleMute()`, `toggleMuteAll()`
- `src/renderer/editors/browser/BrowserPageView.tsx` — `audio-state-changed` event handling
- `src/renderer/editors/browser/BrowserTabsPanel.tsx` — Volume toggle on tabs and extension popup
- `src/renderer/features/tabs/PageTab.tsx` — Page-level volume toggle button
- `src/renderer/theme/icons.tsx` — `VolumeIcon`, `VolumeMutedIcon`

### 8. Home Button
"Go Home" button in the browser toolbar at the first position (before Back). Each internal tab remembers its "home" URL — set when the user first navigates to a real URL (via the URL bar) or when a tab is created with a URL.

- Home button disabled when tab has no home URL (e.g. fresh `about:blank`)
- Tooltip shows "Go to <url>" with the actual home URL
- `HomeIcon` (house SVG) added to icons

**Files modified:**
- `src/renderer/editors/browser/BrowserPageModel.ts` — `homeUrl` on `BrowserTabData`, set in `navigate()` and `createTab()`, `goHome()` method
- `src/renderer/editors/browser/BrowserPageView.tsx` — `homeUrl` in state selector, `handleGoHome` callback, Home button in toolbar
- `src/renderer/theme/icons.tsx` — `HomeIcon`

### 9. Tabs Panel Initially Collapsed
New browser pages now open with the tabs panel collapsed to its minimal width (34px, icon-only mode) instead of 120px. Users who resize the panel have their width persisted in session state.

**Files modified:**
- `src/renderer/editors/browser/BrowserPageModel.ts` — Default `tabsPanelWidth` changed from 120 to 34

### 10. Search Engine Selector
Firefox-style search engine selector in the URL bar. Appears as a clickable label (e.g. "Google ▾") at the start of the URL input in two cases:
1. **Blank page** (`about:blank`) — user can pick which engine to use before typing a search
2. **Search engine results page** — detects the current engine from the URL, shows its name. Clicking and selecting a different engine re-searches the same query on the new engine.

Hidden on all other pages (regular websites).

**Search engines supported (11):** Google (default), Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, Gibiru

**Architecture:**
- `SearchEngine` interface with optional `searchPathPrefix` field (for engines that redirect to path-based URLs, e.g. Perplexity rewrites `/search?q=foo` → `/search/foo-<hash>`)
- `SEARCH_ENGINES` config array in `BrowserPageModel.ts`
- `detectSearchEngine(url)` parses URL hostname + query param to identify engine and extract query; falls back to `searchPathPrefix` path matching when query param is missing
- `searchEngineId` and `lastSearchQuery` persisted in `BrowserPageState`
- `navigate()` stores the raw search query in `lastSearchQuery` and uses selected engine's URL template
- `switchSearchEngine(id)` rewrites current search URL to the new engine; uses `lastSearchQuery` as fallback when query can't be extracted from the URL (path-based redirects)
- Detection uses `urlInput` (synced with webview's actual URL via `did-navigate`) instead of stale Zustand `url` state — ensures selector hides correctly when navigating away from search results
- `WithPopupMenu` renders a dropdown anchored to the engine label in the URL bar
- `startButtonsWidth` prop added to `TextField` component for variable-width start adornments

**Files modified:**
- `src/renderer/editors/browser/BrowserPageModel.ts` — `SearchEngine` interface, `SEARCH_ENGINES` (11 engines), `detectSearchEngine()`, `searchEngineId`/`lastSearchQuery` state, `setSearchEngine()`, `switchSearchEngine()`, updated `navigate()`
- `src/renderer/editors/browser/BrowserPageView.tsx` — Search engine selector UI with `WithPopupMenu`, detection logic using `urlInput`, `startButtonsWidth`
- `src/renderer/components/basic/TextField.tsx` — Added `startButtonsWidth` prop

## Acceptance Criteria

- [x] OAuth popup windows work (Google OAuth on Reddit, etc.)
- [x] Popup windows centered on parent js-notepad window
- [x] "New Tab" button removed from toolbar, "Close Tab" button added
- [x] Closing last tab opens fresh about:blank tab
- [x] Active internal tab has dark background + blue border
- [x] Splitter is transparent, doesn't add visual width to tabs panel
- [x] Compact tabs show extension popup on hover with title + close
- [x] Extension popup seamlessly connects to tab (flat corners at junction)
- [x] Per-tab audio mute toggle (volume icon on audible tabs)
- [x] Page-level audio mute toggle (volume icon on js-notepad page tab)
- [x] Two-level mute: both must be unmuted for sound to play
- [x] Home button navigates to tab's remembered home URL
- [x] Home button tooltip shows "Go to <url>"
- [x] Tabs panel starts collapsed (34px icon-only mode)
- [x] Search engine selector on blank pages and search result pages
- [x] Switching engine on search page re-searches same query
- [x] Selected search engine persisted per browser page
- [x] 11 search engines supported (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, Gibiru)
- [x] Path-based redirect engines (Perplexity) handled via `searchPathPrefix` + `lastSearchQuery` fallback
- [x] Selector hides when navigating away from search results (uses `urlInput` not stale state)
- [x] URL bar suggestions dropdown with search history and navigation history
- [x] Search history persisted per profile, skipped for incognito
- [x] Navigation history per tab, persisted across restarts
- [x] Multi-word filtering with highlighted matches
- [x] Keyboard navigation (ArrowDown/Up, Enter, Escape)
- [x] "Clear" button removes visible filtered entries
- [x] Hostnames added to search history on navigation
- [x] Documentation updated
- [x] No regressions in existing functionality

## Notes

### 2026-02-22
- OAuth popup fix: Electron `setWindowOpenHandler` `disposition` values distinguish link clicks from JS `window.open()`. Link clicks use `foreground-tab`/`background-tab`, JS calls use `default`/`new-window`.
- Renderer code must use `const { ipcRenderer } = require("electron")` instead of `import { ipcRenderer } from "electron"` to avoid Vite bundling errors (`path.join is not a function`).
- Electron `audio-state-changed` event passes `audible` on the event object itself (`e.audible`), not as a second callback parameter.
- The compact tab extension uses `useFloating` from `@floating-ui/react` directly (not the app's `Popper` component) for a lightweight hover popup without click-outside/escape handlers.
- Search engine detection must use `urlInput` (local state synced via `did-navigate` IPC) not `url` from Zustand — Zustand `url` is stale when webview navigates via link clicks.
- Some engines (Perplexity) redirect search URLs from query-param format (`/search?q=foo`) to path-based format (`/search/foo-<hash>`), losing the query param. Solved by: (1) `searchPathPrefix` on `SearchEngine` for detection, (2) `lastSearchQuery` state field remembering the original query for engine switching.

## Related

- Depends on: [US-025 Basic Browser Editor](../US-025-basic-browser-editor/README.md)
- Depends on: [US-026 Browser Internal Tabs](../US-026-browser-internal-tabs/README.md)
- Depends on: [US-027 Browser Profiles & Incognito](../US-027-browser-profiles-downloads/README.md)
- Depends on: [US-029 Browser Context Menu](../US-029-browser-context-menu/README.md)
- Related: [Browser Editor Architecture](../../architecture/browser-editor.md)
