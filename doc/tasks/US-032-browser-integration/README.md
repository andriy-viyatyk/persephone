# US-032: Browser Integration — Link Opening & Context Menu

## Status

**Status:** Planned
**Priority:** Medium
**Started:** —
**Completed:** —
**Depends on:** US-025 (Basic Browser Editor), US-027 (Browser Profiles)

## Summary

Add a setting to control how external links open (default OS browser vs. internal Browser editor), implement smart browser tab routing (find nearest browser tab to the right), and add link context menu items in Monaco and Markdown editors.

## Why

- Currently all external links (http/https) always open in the OS default browser via `shell.openExternal()` — there's even a TODO comment in the code: `// todo: open in browser tab when implemented`
- Users who have the built-in Browser editor open want links from their documents to open there, not in a separate application
- The smart routing (nearest browser to the right) enables workflows like: personal links doc → personal browser, work links doc → work browser
- Right-click options give users per-link control regardless of the global setting

## Current Link Handling (Investigation)

### Where links are intercepted

| Location | File | How |
|----------|------|-----|
| Main window `window.open()` | `src/main/open-window.ts:114-118` | `setWindowOpenHandler` → `shell.openExternal(url)` |
| Main window navigation | `src/main/open-window.ts:120-169` | `will-navigate` event → blocks external URLs → `shell.openExternal(url)` |
| About page links | `src/renderer/editors/about/AboutPage.tsx:223` | Direct `shell.openExternal(url)` call |
| HTML Preview | `src/renderer/editors/html/HtmlView.tsx:5` | All link clicks blocked by injected script |

### How each editor handles links

- **Monaco Editor**: Built-in Ctrl+Click link detection. Clicking a link triggers `will-navigate` on the main window webContents, which the main process intercepts and calls `shell.openExternal()`.
- **Markdown Preview**: Links are rendered as `<a>` tags via `resolveRelatedLink()`. Clicking navigates the webContents → main process intercepts → `shell.openExternal()`. Right-click already shows "Copy Link" via the app popup menu system.
- **HTML Preview**: All link clicks are blocked — no navigation occurs.
- **Browser Editor**: Has its own link handling (new internal tabs, context menu). Not affected by this task.
- **Notebook Editor**: Uses the same Markdown rendering — inherits Markdown behavior.

### Key observation

Both interception points (`setWindowOpenHandler` and `will-navigate`) are in the **main process** (`open-window.ts`), but the setting lives in the **renderer** (`appSettings`). The main process must communicate with the renderer to decide where to open a link.

## Acceptance Criteria

- [ ] New setting `"link-open-behavior"` with values: `"default-browser"` (default) or `"internal-browser"`
- [ ] Settings page UI for choosing link open behavior
- [ ] When set to `"internal-browser"`, external links from Monaco and Markdown open in the nearest Browser tab to the right of the current page
- [ ] If no Browser tab exists to the right, a new Browser page is created (using the default profile) and inserted after the current page
- [ ] Right-click context menu on links in Monaco shows: "Open in Default Browser", "Open in Internal Browser", "Open in Incognito"
- [ ] Right-click context menu on links in Markdown Preview shows the same three options (in addition to existing "Copy Link")
- [ ] Monaco Ctrl+Click on links respects the global setting
- [ ] About page links always open in default browser (unchanged — these are app-related links)
- [ ] HTML Preview links remain blocked (unchanged)
- [ ] Documentation updated
- [ ] No regressions in existing functionality

## Technical Approach

### Phase 1: Setting & IPC Infrastructure

**New setting:**
```typescript
// app-settings.ts
"link-open-behavior": "default-browser" | "internal-browser"
```

**New IPC event — `eOpenUrl`:**
Instead of the main process calling `shell.openExternal()` directly, it sends a new `eOpenUrl` event to the renderer with the URL. The renderer then decides based on the setting.

```
Main Process                    IPC                    Renderer
─────────────               ──────────         ─────────────────────
will-navigate (http url)   →  eOpenUrl(url)  →  Check appSettings
setWindowOpenHandler(url)  →  eOpenUrl(url)  →    → "default-browser": shell.openExternal(url)
                                                  → "internal-browser": openUrlInBrowserTab(url)
```

The renderer can call `shell.openExternal()` directly since `nodeIntegration: true`.

**Files:**
- `src/ipc/api-types.ts` — Add `eOpenUrl` to `EventEndpoint`
- `src/ipc/renderer/renderer-events.ts` — Register `eOpenUrl` handler
- `src/main/open-window.ts` — Replace `shell.openExternal(url)` with `this.send(EventEndpoint.eOpenUrl, url)`
- `src/renderer/store/app-settings.ts` — Add `"link-open-behavior"` setting

### Phase 2: Smart Browser Tab Routing

**New utility function — `openUrlInBrowserTab(url, options?)`:**

Located in `src/renderer/store/page-actions.ts`. Logic:

1. Get current active page index from `pagesModel.state.get().pages`
2. Search pages to the **right** of the current page for one with `type === "browserPage"`
3. If found: call `model.addTab(url)` on that browser page's model to open as a new internal tab
4. If not found: create a new Browser page (default profile), insert it after the current page, and navigate to the URL

```typescript
export async function openUrlInBrowserTab(url: string, options?: {
    incognito?: boolean;
}): Promise<void> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.getActivePage();
    const activeIndex = pages.indexOf(activePage);

    if (!options?.incognito) {
        // Search right for existing browser tab
        for (let i = activeIndex + 1; i < pages.length; i++) {
            if (pages[i].state.get().type === "browserPage") {
                const browserModel = pages[i] as BrowserPageModel;
                browserModel.addTab(url);
                pagesModel.showPage(pages[i].state.get().id);
                return;
            }
        }
    }

    // No browser tab found to the right (or incognito requested) — create new one
    const browserModule = await import("../editors/browser/BrowserPageView");
    const model = await browserModule.default.newEmptyPageModel("browserPage");
    if (model) {
        if (options?.incognito) {
            model.state.update((s: any) => { s.isIncognito = true; });
        }
        await model.restore();
        pagesModel.addPageAfter(model, activePage); // New method needed
        model.addTab(url); // or navigate the initial tab
    }
}
```

**Note:** `pagesModel.addPageAfter()` doesn't exist yet — need to add a method that inserts a page at a specific position instead of at the end.

### Phase 3: Monaco Editor Link Context Menu

**Approach:** Intercept the `contextmenu` DOM event on the Monaco editor container and detect if the right-click occurred on a link.

Monaco renders detected links with the CSS class `detected-link` (or similar). On right-click:
1. Check if `e.target` or its parent has the link class
2. Extract the URL from the link element's text content or data attribute
3. If a link is found, add items to `e.nativeEvent.menuItems` (same pattern as Markdown)

**Alternative approach — `editor.addAction()`:**
Monaco supports `editor.addAction({ id, label, contextMenuGroupId })` to add items to its built-in context menu. However, these items are always visible (can only be conditionally shown via `precondition` context keys, not link detection). This makes it unsuitable for link-specific items.

**Chosen approach:** DOM-level context menu interception on the Monaco container, adding items to the app's popup menu. This requires **suppressing Monaco's built-in context menu** when a link is right-clicked, which could be done by calling `e.preventDefault()` + `e.stopPropagation()` and showing only the app menu.

**Concern:** Suppressing Monaco's context menu only on links while keeping it for normal text is tricky. A simpler alternative: always let Monaco's context menu appear for non-link right-clicks, and add a thin wrapper that detects link right-clicks and shows the app popup menu instead.

**Files:**
- `src/renderer/editors/text/TextEditor.tsx` — Add `onContextMenu` handler to the editor container

### Phase 4: Markdown Link Context Menu

**Approach:** Extend the existing `onContextMenu` handler in `MarkdownView.tsx` (line 613-628). When right-clicking on an `<a>` tag, add three more menu items alongside the existing "Copy Link":

```typescript
// Existing
{ label: "Copy Link", icon: <CopyIcon />, onClick: () => ... }

// New items
{ label: "Open in Default Browser", onClick: () => shell.openExternal(href) }
{ label: "Open in Internal Browser", onClick: () => openUrlInBrowserTab(href) }
{ label: "Open in Incognito", onClick: () => openUrlInBrowserTab(href, { incognito: true }) }
```

**Files:**
- `src/renderer/editors/markdown/MarkdownView.tsx` — Extend `onContextMenu` handler

### Phase 5: Settings Page UI

Add a "Links" section to the Settings page with a dropdown/radio for `"link-open-behavior"`.

**Files:**
- `src/renderer/editors/settings/SettingsPage.tsx` — Add Links section

## Concerns & Open Questions

### 1. Monaco context menu conflict
Monaco has its own context menu (cut/copy/paste/command palette/etc.). When right-clicking on a link, we want to show link-specific items. Options:
- **Option A:** Replace Monaco's context menu entirely with the app popup menu (loses Monaco items like "Go to Definition", "Peek")
- **Option B:** Show a small floating menu near the link on Ctrl+Right-Click or similar modifier
- **Option C:** Detect link right-clicks, show app menu with link items + generic "Show Editor Menu" fallback
- **Option D:** Don't add link context menu to Monaco — only change the Ctrl+Click behavior based on settings. Users can copy the URL and paste it. This is the simplest approach.

**Recommendation:** Start with **Option D** (simplest) — Monaco Ctrl+Click respects the setting, no context menu changes. Add context menu in a follow-up if users request it. Monaco's context menu is complex and intercepting it cleanly is non-trivial.

### 2. Page insertion order
`pagesModel.addPage()` always adds to the end. We need `addPageAfter(page, referencePage)` to insert the new browser tab immediately after the current document. This is a small addition to `pages-store.ts`.

### 3. About page links
The About page calls `shell.openExternal()` directly in the renderer. These are app-specific links (GitHub, downloads) and should always open in the OS browser regardless of the setting.

### 4. Notebook editor
Notebook uses MarkdownView for note rendering. If we update MarkdownView's context menu and link behavior, notebook inherits it automatically.

### 5. Browser tab profile selection
When creating a new browser tab for a link, should it use the default profile or no profile? Using the default profile is consistent with the "Browser" quick-add menu item.

### 6. Multiple windows
If the user has multiple js-notepad windows, the link should open in a browser tab within the same window. The `eOpenUrl` event is sent to the specific window's webContents, so this works naturally.

## Files to Modify

- `src/ipc/api-types.ts` — Add `eOpenUrl` event endpoint
- `src/ipc/renderer/renderer-events.ts` — Register `eOpenUrl` handler
- `src/main/open-window.ts` — Replace `shell.openExternal()` with `eOpenUrl` event
- `src/renderer/store/app-settings.ts` — Add `"link-open-behavior"` setting
- `src/renderer/store/page-actions.ts` — Add `openUrlInBrowserTab()` function
- `src/renderer/store/pages-store.ts` — Add `addPageAfter()` method
- `src/renderer/editors/markdown/MarkdownView.tsx` — Extend link context menu
- `src/renderer/editors/settings/SettingsPage.tsx` — Add Links settings section
- `src/shared/types.ts` — (if needed for type definitions)

## Implementation Progress

### Phase 1: Setting & IPC Infrastructure
- [ ] Add `"link-open-behavior"` to `AppSettingsKey` and defaults
- [ ] Add `eOpenUrl` event to `EventEndpoint` enum
- [ ] Register `eOpenUrl` renderer event handler
- [ ] Replace `shell.openExternal()` in `open-window.ts` with `eOpenUrl` event
- [ ] Implement renderer-side URL routing (check setting, dispatch to browser or shell)

### Phase 2: Smart Browser Tab Routing
- [ ] Add `addPageAfter()` to `PagesModel`
- [ ] Implement `openUrlInBrowserTab()` in `page-actions.ts`
- [ ] Test: link opens in nearest browser tab to the right
- [ ] Test: new browser tab created when none exists to the right

### Phase 3: Markdown Link Context Menu
- [ ] Add "Open in Default Browser", "Open in Internal Browser", "Open in Incognito" to Markdown link right-click
- [ ] Test in standalone Markdown Preview and Notebook embedded Markdown

### Phase 4: Monaco Link Behavior
- [ ] Monaco Ctrl+Click respects the global setting (via the `eOpenUrl` event flow — no Monaco-specific changes needed since it already goes through `will-navigate`)
- [ ] (Future) Consider Monaco link context menu if users request it

### Phase 5: Settings Page UI
- [ ] Add "Links" section to Settings page
- [ ] Dropdown or radio for link open behavior

### Phase 6: Documentation
- [ ] Update `docs/editors.md`
- [ ] Update `docs/whats-new.md`
- [ ] Update `doc/architecture/browser-editor.md`

## Notes

- The existing TODO comment in `open-window.ts:115` (`// todo: open in browser tab when implemented`) confirms this was always planned
- Monaco Ctrl+Click on links already goes through `will-navigate` → main process → so changing the main process to send `eOpenUrl` instead of `shell.openExternal` automatically makes Monaco respect the setting without any Monaco-specific code
- The `resolveRelatedLink()` utility in `path-utils.ts` correctly distinguishes between local file links and external URLs — local file links (`file://`) are handled separately and unaffected by this feature

## Related

- Depends on: [US-025 Basic Browser Editor](../US-025-basic-browser-editor/README.md)
- Depends on: [US-027 Browser Profiles & Incognito](../US-027-browser-profiles-downloads/README.md)
- Related: [US-028 Browser Bookmarks](../US-028-browser-bookmarks/README.md)
- Related: [US-030 Download Manager](../US-030-download-manager/README.md)
