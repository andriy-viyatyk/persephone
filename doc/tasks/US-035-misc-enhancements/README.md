# US-035: Miscellaneous Enhancements

## Status

**Status:** Done
**Priority:** Medium
**Started:** 2026-02-26
**Completed:** 2026-02-26

## Summary

A working task for collecting small enhancements and adjustments across the application. Each enhancement is described as a separate item below.

## Enhancements

### 1. Link Editor — Hostnames Panel

Add a collapsible "Hostnames" panel to the Link Editor sidebar (alongside Categories and Tags). The panel displays hostnames extracted from all links and allows filtering by hostname.

**Behavior:**
- Hostnames collected from all links using `getHostname()` (already exists in `favicon-cache.ts`)
- New `selectedHostname` state field, works like `selectedCategory` / `selectedTag`
- Only one filter active at a time: category OR tag OR hostname
- Panel shows hostname list with link counts
- Selecting a hostname filters the link list to show only links from that host

**Files to modify:**
- `src/renderer/editors/link-editor/LinkEditorModel.ts` — add `selectedHostname`, `hostnames`, `hostnamesSize` state; update `applyFilters()` and `updateMetadata()`
- `src/renderer/editors/link-editor/LinkEditor.tsx` — add Hostnames collapsible panel

## Implementation Progress

### Enhancement 1: Hostnames Panel
- [x] Add state fields (`selectedHostname`, `hostnames`, `hostnamesSize`, expand `expandedPanel` type)
- [x] Collect hostnames in `loadHostnames()`
- [x] Add hostname filtering in `applyFilters()`
- [x] Add `setSelectedHostname()` and `getHostnameCount()` methods
- [x] Add per-hostname view mode support in `getViewMode()`/`setViewMode()`
- [x] Add `hostnameViewMode` to `LinkEditorData.state` type
- [x] Add Hostnames collapsible panel in `LinkEditor.tsx`
- [x] Add Breadcrumb for hostnames panel in toolbar

### 2. Link Editor — Persist Selection State in Cache

Remember the selected category, tag, hostname, and which panel is expanded across app restarts. Uses the page cache pattern (`filesModel.saveCacheFile`/`getCacheFile`) with name `"link-editor"`, producing `<id>_link-editor.txt`. Cache file is auto-deleted when the page is closed.

**Behavior:**
- On first data load, restore selection state from cache
- On selection change (panel switch, category/tag/hostname click), save to cache (debounced 300ms)
- State survives app restart but is cleaned up when the tab is closed

**Files modified:**
- `src/renderer/editors/link-editor/LinkEditorModel.ts` — `restoreSelectionState()`, `saveSelectionState()`, debounced save on selection setters

### Enhancement 2: Persist Link Editor Selection State
- [x] Add `restoreSelectionState()` — loads from cache on first `loadData()` call
- [x] Add `saveSelectionState()` (debounced 300ms) — saves `expandedPanel`, `selectedCategory`, `selectedTag`, `selectedHostname`
- [x] Call save on `setExpandedPanel`, `setSelectedCategory`, `setSelectedTag`, `setSelectedHostname`

### 3. ToDo Editor — Persist Selection State in Cache

Same pattern as Link Editor. Remember `selectedList` and `selectedTag` across app restarts using cache file `<id>_todo-editor.txt`.

**Files modified:**
- `src/renderer/editors/todo/TodoEditorModel.ts` — `restoreSelectionState()`, `saveSelectionState()`, debounced save on selection setters

### Enhancement 3: Persist ToDo Editor Selection State
- [x] Add `restoreSelectionState()` — loads from cache on first `loadData()` call
- [x] Add `saveSelectionState()` (debounced 300ms) — saves `selectedList`, `selectedTag`
- [x] Call save on `setSelectedList`, `setSelectedTag`

### 4. Pinned Tab — File Path Tooltip

Show file path tooltip for pinned tabs. Non-pinned tabs use `data-tooltip-id` on `.title-label` (original behavior). Pinned tabs use an invisible absolutely-positioned overlay (`pinned-tooltip-trigger`) as the tooltip anchor. The overlay sits behind interactive elements (z-index layering), so hovering buttons shows their own tooltips, while hovering dead space (e.g. the close button area, which has `pointer-events: none` in pinned mode) shows the file path tooltip.

**Files modified:**
- `src/renderer/features/tabs/PageTab.tsx` — add pinned tooltip overlay, keep `data-tooltip-id` on `.title-label` for non-pinned tabs

### Enhancement 4: Pinned Tab Tooltip
- [x] Add `.pinned-tooltip-trigger` overlay (absolutely positioned, rendered only for pinned tabs with filePath)
- [x] Add CSS to elevate direct children above overlay in pinned mode (`position: relative; z-index: 1`)
- [x] Keep `data-tooltip-id` on `.title-label` for non-pinned tabs (original behavior)
- [x] Add `<Tooltip>` component with `delayShow={1500}` and `place="bottom"`

### 5. Browser — Popup/Tab Spam Blocking

Block sites from spamming the user with excessive popup windows and internal tabs. Similar to Chrome's popup blocker.

#### Investigation Summary

**Current behavior (no protection):**
- `target="_blank"` links → converted to internal browser tabs via `new-window` IPC event → `model.addTab(url)` in renderer
- `window.open()` calls → opened as real Electron `BrowserWindow` popups via `setWindowOpenHandler` returning `{ action: "allow" }` in main process
- No rate limiting — a page can create unlimited tabs and popup windows
- No user-gesture detection — scripts can open popups at any time

**Two separate code paths to protect:**

| Type | Trigger | Handler Location | Decision Point |
|---|---|---|---|
| Internal tabs | `target="_blank"` links | Renderer (`BrowserWebviewModel.ts` line 172-176) | `handleBrowserEvent("new-window")` |
| Popup windows | `window.open()` | Main process (`browser-service.ts` line 200-224) | `setWindowOpenHandler` callback |

#### Proposed Approach: Time-Window Rate Limiting

**Why rate limiting (not user-gesture detection):**
- Electron's `setWindowOpenHandler` does not provide user-gesture info
- User-gesture tracking on `<webview>` elements is unreliable (we don't control the guest page's event loop)
- Rate limiting is simple, predictable, and handles both code paths uniformly
- Chrome also uses rate limiting as part of its popup blocking heuristic

**Algorithm:**
- Track timestamps of popup/tab creation per webview (by `internalTabId`)
- If more than **N requests within T seconds**, block subsequent requests until the window expires
- Suggested thresholds: **3 popups/tabs within 2 seconds** (configurable)
- First N requests always pass through (no delay for legitimate use)
- When blocked: show a notification bar in the browser UI ("Popups blocked from this site")
- User can click "Allow" on the notification to temporarily whitelist the origin for the session

**What gets blocked vs. allowed:**

| Scenario | Blocked? | Reason |
|---|---|---|
| User clicks a link with `target="_blank"` | No | Rate < threshold (one-off click) |
| Site script opens 10 tabs in a loop | After 3rd | Rate exceeded |
| Site script opens 10 popup windows | After 3rd | Rate exceeded |
| OAuth popup (user-initiated click → `window.open()`) | No | Single request, rate < threshold |
| Payment confirmation popup | No | Single request |
| Chat site opening notification popups in bursts | After 3rd | Rate exceeded |

#### Concerns

1. **Main process sync decision**: `setWindowOpenHandler` must return synchronously (`{ action: "allow" }` or `{ action: "deny" }`). Rate-limit state must live in the main process for popup windows. Internal tab blocking can be in the renderer.

2. **Authentication popups**: OAuth/SSO flows typically open a single popup on user click. Rate limit of 3 within 2s should never affect these. But some login flows open a chain (redirect → popup → intermediate page → token). We should be safe since these are sequential, not concurrent.

3. **Legitimate multi-tab opens**: Some sites (e.g., "Open all links" feature) intentionally open many tabs. The notification bar with "Allow" gives the user a way to override. We could also consider an "Allow popups for this site" context menu or setting.

4. **Two separate rate-limit stores**: Main process needs its own counter (for real popups), renderer needs its own (for internal tabs). They should share the same threshold logic but can't easily share state without IPC round-trips. Keeping them separate is simpler and still effective.

5. **Popup close tracking**: We don't currently track when popup BrowserWindows are closed. Not needed for rate limiting, but could be useful for a future "manage popups" feature.

#### Implementation

**Files modified:**
- `src/ipc/popup-rate-limiter.ts` — new `PopupRateLimiter` class (shared between main/renderer)
- `src/ipc/browser-ipc.ts` — added `"popups-blocked"` event type, `allowPopups` IPC channel
- `src/main/browser-service.ts` — rate-limit check in `setWindowOpenHandler`, `allowPopups` IPC handler
- `src/renderer/editors/browser/BrowserWebviewModel.ts` — rate-limit check in `handleBrowserEvent("new-window")`, `"popups-blocked"` handler
- `src/renderer/editors/browser/BrowserPageModel.ts` — `blockedPopupCount` state, `dismissBlockedPopups()`, `allowPopups()` methods
- `src/renderer/editors/browser/BrowserPageView.tsx` — notification bar UI

### Enhancement 5: Browser Popup Blocking
- [x] Create `PopupRateLimiter` utility in `src/ipc/popup-rate-limiter.ts`
- [x] Add `"popups-blocked"` event type and `allowPopups` IPC channel to `browser-ipc.ts`
- [x] Add rate limiting to main process `setWindowOpenHandler` for `window.open()` popups
- [x] Add rate limiting to renderer `handleBrowserEvent("new-window")` for internal tabs
- [x] Add `blockedPopupCount` state, `dismissBlockedPopups()`, `allowPopups()` to `BrowserPageModel`
- [x] Add notification bar UI between loading bar and browser body in `BrowserPageView`

## Notes

### 2026-02-26
- Task created as a working document for incremental enhancements
