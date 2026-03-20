# US-223: PageManager Component — Portal-Based DOM Stability for Browser Tabs

## Goal

Create a reusable `PageManager` component that uses React portals with imperatively managed DOM placeholders to prevent `<webview>` elements from being destroyed/recreated when the tab array changes (tabs closed, reordered).

**Scope:** Apply to Browser editor internal tabs first. Main app pages will be a follow-up task.

## Background

### The Problem

In `BrowserPageView.tsx:666-674`, browser tabs are rendered with:
```tsx
{tabs.map((tab) => (
    <BrowserWebviewItem key={tab.id} model={model} tab={tab} ... />
))}
```

When a tab is removed (e.g., closing tab at index 0), React's reconciliation detaches and reinserts DOM nodes for remaining tabs even though keys are stable. For regular React components this preserves state, but the browser treats a reinserted `<webview>` as a new element and **reloads it**, losing user data.

### Current Tab Architecture

- **State:** `BrowserPageModel.state.tabs: BrowserTabData[]` — simple array
- **Tab IDs:** Incrementing strings like `bt-1`, `bt-2` via `createInternalTabId()`
- **Visibility:** Active tab has no `.hidden` class; inactive tabs use `visibility: hidden` + `pointerEvents: none`
- **Positioning:** All webview wrappers use `position: absolute; inset: 0` — they stack, only one visible
- **Webview refs:** Stored in `BrowserWebviewModel.webviewRefs` Map and `webviewReady` Set
- **IPC lifecycle:** `dom-ready` → register with main process; unmount → unregister. See `BrowserPageView.tsx:254-350`
- **Navigation:** `webview.loadURL()` called imperatively via refs, not via React props

### Why Portals Solve This

React portals (`createPortal`) render React component trees into DOM nodes that React doesn't own. The placeholder divs are created/removed imperatively (`document.createElement`, `container.removeChild`). When a tab is closed:

1. Its placeholder div is removed with `removeChild` — browser removes only that node, siblings untouched
2. React sees one fewer portal in the array — unmounts that portal's components
3. Remaining portals still point to their original (unchanged) placeholder divs — **no DOM manipulation**

## Implementation Plan

### Step 1: Create `PageManager` Component

**File:** `src/renderer/components/page-manager/PageManager.tsx` (new)

```typescript
interface PageManagerProps {
    /** Unique IDs for each page/tab — must be stable across renders */
    pageIds: string[];
    /** ID of the currently active (visible) page */
    activeId: string;
    /** Render function — receives page ID, returns React element */
    renderPage: (id: string) => React.ReactNode;
    /** Optional CSS class for the container div */
    className?: string;
}
```

**Internal logic:**

1. Maintain a `useRef<Map<string, HTMLDivElement>>()` mapping page IDs → placeholder divs
2. Maintain a `useRef<HTMLDivElement>()` for the container
3. On each render, diff `pageIds` against the Map:
   - **New IDs:** `document.createElement("div")`, set `style.position = "absolute"`, `style.inset = "0"`, append to container, add to Map
   - **Removed IDs:** `container.removeChild(placeholder)`, remove from Map
   - **Existing IDs:** No DOM changes — only update `display` style (active vs hidden)
4. Active placeholder gets `display = ""` (or `"block"`), others get `display = "none"` (or `visibility = "hidden"` + `pointerEvents = "none"` to match current behavior)
5. Return JSX:
   ```tsx
   <>
     <div ref={containerRef} className={className} />
     {pageIds.map(id => {
       const placeholder = placeholdersRef.current.get(id);
       return placeholder ? createPortal(renderPage(id), placeholder, id) : null;
     })}
   </>
   ```

**Key design decisions:**
- The diff logic runs in `useLayoutEffect` (not `useEffect`) to ensure placeholders exist before portals render
- Placeholders are never reordered — their DOM position doesn't matter since all are `position: absolute`
- The `key` on `createPortal` is the page `id` — ensures stable React reconciliation of portals

### Step 2: Visibility Strategy

**Decision:** Use `display: none` for inactive placeholders. This is consistent with how js-notepad main pages work and is simpler. Will verify during testing that webviews behave correctly.

### Step 3: Integrate into BrowserPageView

**File:** `src/renderer/editors/browser/BrowserPageView.tsx`

**Before (lines 662-674):**
```tsx
<div className="webview-area">
    {bookmarksReady && model.bookmarks && (!url || url === "about:blank") && (
        <BlankPageLinks bookmarks={model.bookmarks} />
    )}
    {tabs.map((tab) => (
        <BrowserWebviewItem
            key={tab.id}
            model={model}
            tab={tab}
            isActive={tab.id === activeTabId}
            partition={model.partition}
        />
    ))}
    {popupOpen && <div className="webview-click-overlay" />}
    {findBarVisible && ( ... )}
</div>
```

**After:**
```tsx
<div className="webview-area">
    <PageManager
        className="webview-tabs-host"
        pageIds={tabs.map(t => t.id)}
        activeId={activeTabId}
        renderPage={(tabId) => {
            const tab = tabs.find(t => t.id === tabId)!;
            const isActive = tab.id === activeTabId;
            const isBlank = !tab.url || tab.url === "about:blank";
            // Render BlankPageLinks INSIDE the portal for about:blank tabs
            // This preserves scroll position across tab switches
            if (isBlank && bookmarksReady && model.bookmarks) {
                return <BlankPageLinks bookmarks={model.bookmarks} />;
            }
            return (
                <BrowserWebviewItem
                    model={model}
                    tab={tab}
                    isActive={isActive}
                    partition={model.partition}
                />
            );
        }}
    />
    {popupOpen && <div className="webview-click-overlay" />}
    {findBarVisible && ( ... )}
</div>
```

**Key change:** `BlankPageLinks` moves inside the portal's `renderPage`. Each `about:blank` tab gets its own portal placeholder, so scroll position is preserved when switching tabs. This also eliminates the awkward dual rendering of BlankPageLinks + webview.

### Step 4: Adjust BrowserWebviewItem

**File:** `src/renderer/editors/browser/BrowserPageView.tsx`

The `BrowserWebviewItem` component currently manages its own wrapper div with the `.hidden` class (line 353):
```tsx
<div className={`webview-wrapper${isActive ? "" : " hidden"}`}>
```

Since `PageManager` now handles visibility at the placeholder level, the wrapper div and its `.hidden` class logic may be simplified or removed. The `BrowserWebviewItem` could render just the `<webview>` directly.

However, review if the wrapper div serves other purposes (background color, flex layout for the webview). If so, keep it but remove the `.hidden` toggling.

### Step 5: Adjust Styles

**File:** `src/renderer/editors/browser/BrowserPageView.tsx` (styled component `BrowserPageViewRoot`)

- The `.webview-area` styles (lines 103-108) set up the flex container
- The `.webview-wrapper` styles (lines 110-122) handle absolute positioning and hiding
- With PageManager, the placeholder divs take over the role of `.webview-wrapper`
- Either:
  - (a) Apply `.webview-wrapper` styles to PageManager's placeholder divs via a `placeholderClassName` prop or `placeholderStyle` prop
  - (b) Keep `.webview-wrapper` inside `BrowserWebviewItem` and let PageManager's placeholders just be `position: absolute; inset: 0` containers

**Recommendation:** Option (b) is simpler — PageManager stays generic, editor-specific styles stay in the editor.

### Step 6: Testing

No automated tests — manual testing only.

1. **Basic tab operations:**
   - Open browser page, open 3+ tabs with different websites
   - Close first tab → remaining tabs should NOT reload
   - Close middle tab → remaining tabs should NOT reload
   - Close last tab → previous tab activates, no reload

2. **State preservation:**
   - Fill out a form on a website, switch to another tab, close a different tab, switch back → form data preserved
   - Scroll position on a page preserved across tab closes
   - Playing video/audio continues uninterrupted when other tabs close

3. **IPC integrity:**
   - After closing tabs, remaining tabs still show correct title/favicon
   - Navigation (back/forward/reload) works on remaining tabs
   - Find-in-page works on remaining tabs
   - DevTools opens for correct tab

4. **Edge cases:**
   - Close all tabs except one (via "Close Other Tabs" context menu)
   - Close tabs below (via "Close Tabs Below" context menu)
   - Open many tabs (10+), close several in various positions
   - Rapid tab open/close sequences

## Resolved Concerns

1. **Visibility strategy** — Use `display: none`. Consistent with main app pages. Will verify webview behavior during testing.
2. **BlankPageLinks** — Moves inside the portal's `renderPage`. Rendered instead of webview for `about:blank` tabs. Fixes scroll position issue.
3. **webview-click-overlay z-index** — Verify after implementation.
4. **Event bubbling through portals** — Verify after implementation.
5. **Main app pages** — Out of scope. Separate future task, only if browser tabs work well.

## Acceptance Criteria

- [ ] `PageManager` component created and reusable
- [ ] Browser editor tabs use `PageManager` for webview rendering
- [ ] Closing a browser tab does NOT cause remaining webviews to reload
- [ ] All existing browser tab functionality works: navigation, find, devtools, title/favicon, audio, popups
- [ ] BlankPageLinks overlay still works on empty tabs
- [ ] Context menu operations (Close Other, Close Below) work correctly

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/components/page-manager/PageManager.tsx` | **New** — reusable portal-based page manager |
| `src/renderer/editors/browser/BrowserPageView.tsx` | Replace `.map()` with `<PageManager>`, simplify `BrowserWebviewItem` wrapper |
