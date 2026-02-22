# US-032: Browser Integration — Link Opening & Context Menu

## Status

**Status:** Done
**Priority:** Medium
**Started:** 2026-02-22
**Completed:** 2026-02-22
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
- [ ] When set to `"internal-browser"`, external links from Monaco and Markdown open in the nearest Browser tab (search right first, then left from the active page)
- [ ] If no Browser tab exists in any direction, a new Browser page is created (using the default profile) as the last tab
- [ ] Right-click context menu on links in Markdown Preview shows: "Open in Default Browser", "Open in Internal Browser", "Open in Incognito" (in addition to existing "Copy Link")
- [ ] Monaco Ctrl+Click on links respects the global setting (no Monaco context menu changes)
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

Located in `src/renderer/store/page-actions.ts`. Uses the active page as the reference point (links are always clicked on the active page, so no need to pass a pageId parameter).

**Search order:**
1. Search pages to the **right** of the active page for one with `type === "browserPage"`
2. If not found, search pages to the **left** of the active page
3. If still not found: create a new Browser page (default profile) as the last tab

```typescript
export async function openUrlInBrowserTab(url: string, options?: {
    incognito?: boolean;
}): Promise<void> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.getActivePage();
    const activeIndex = pages.indexOf(activePage);

    if (!options?.incognito) {
        // 1. Search right for existing browser tab
        for (let i = activeIndex + 1; i < pages.length; i++) {
            if (pages[i].state.get().type === "browserPage") {
                pages[i].addTab(url);
                pagesModel.showPage(pages[i].state.get().id);
                return;
            }
        }
        // 2. Search left for existing browser tab
        for (let i = activeIndex - 1; i >= 0; i--) {
            if (pages[i].state.get().type === "browserPage") {
                pages[i].addTab(url);
                pagesModel.showPage(pages[i].state.get().id);
                return;
            }
        }
    }

    // 3. No browser tab found (or incognito requested) — create new one as last tab
    await showBrowserPage(options?.incognito ? { incognito: true } : undefined);
    // The newly created browser page is now active; navigate its initial tab
    // ... addTab(url) on the new model
}
```

### Phase 3: Markdown Link Context Menu

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

### Phase 4: Settings Page UI

Add a "Links" section to the Settings page with a dropdown/radio for `"link-open-behavior"`.

**Files:**
- `src/renderer/editors/settings/SettingsPage.tsx` — Add Links section

## Design Decisions

1. **About page links** — always open in the OS default browser (unchanged). These are app-specific links (GitHub, downloads).
2. **Notebook editor** — inherits Markdown context menu and link behavior automatically.
3. **Browser tab profile** — new browser pages created for links use the default profile (configured in Settings), consistent with the "Browser" quick-add menu item.
4. **Multiple windows** — search for browser tabs only within the current window. If none found, create a new one in the current window. The `eOpenUrl` event is sent to the specific window's webContents, so this works naturally.

## Files to Modify

- `src/ipc/api-types.ts` — Add `eOpenUrl` event endpoint
- `src/ipc/renderer/renderer-events.ts` — Register `eOpenUrl` handler
- `src/main/open-window.ts` — Replace `shell.openExternal()` with `eOpenUrl` event
- `src/renderer/store/app-settings.ts` — Add `"link-open-behavior"` setting
- `src/renderer/store/page-actions.ts` — Add `openUrlInBrowserTab()` function
- `src/renderer/editors/markdown/MarkdownView.tsx` — Extend link context menu
- `src/renderer/editors/settings/SettingsPage.tsx` — Add Links settings section
- `src/shared/types.ts` — (if needed for type definitions)

## Implementation Progress

### Phase 1: Setting & IPC Infrastructure
- [x] Add `"link-open-behavior"` to `AppSettingsKey` and defaults
- [x] Add `eOpenUrl` event to `EventEndpoint` enum
- [x] Register `eOpenUrl` renderer event handler
- [x] Replace `shell.openExternal()` in `open-window.ts` with `eOpenUrl` event
- [x] Implement renderer-side URL routing (check setting, dispatch to browser or shell)

### Phase 2: Smart Browser Tab Routing
- [x] Implement `openUrlInBrowserTab()` in `page-actions.ts`
- [ ] Test: link opens in nearest browser tab to the right
- [ ] Test: link opens in nearest browser tab to the left (when none to the right)
- [ ] Test: new browser tab created when none exists in either direction

### Phase 3: Markdown Link Context Menu
- [x] Add "Open in Default Browser", "Open in Internal Browser", "Open in Incognito" to Markdown link right-click
- [ ] Test in standalone Markdown Preview and Notebook embedded Markdown

### Phase 4: Settings Page UI
- [x] Add "Links" section to Settings page
- [x] Dropdown or radio for link open behavior

### Phase 5: Documentation
- [x] Update `docs/editors.md`
- [x] Update `docs/whats-new.md`
- [x] Update `doc/architecture/browser-editor.md`

## Notes

- The existing TODO comment in `open-window.ts:115` (`// todo: open in browser tab when implemented`) confirms this was always planned
- Monaco Ctrl+Click on links already goes through `will-navigate` → main process → so changing the main process to send `eOpenUrl` instead of `shell.openExternal` automatically makes Monaco respect the setting without any Monaco-specific code
- The `resolveRelatedLink()` utility in `path-utils.ts` correctly distinguishes between local file links and external URLs — local file links (`file://`) are handled separately and unaffected by this feature

## Related

- Depends on: [US-025 Basic Browser Editor](../US-025-basic-browser-editor/README.md)
- Depends on: [US-027 Browser Profiles & Incognito](../US-027-browser-profiles-downloads/README.md)
- Related: [US-028 Browser Bookmarks](../US-028-browser-bookmarks/README.md)
- Related: [US-030 Download Manager](../US-030-download-manager/README.md)
