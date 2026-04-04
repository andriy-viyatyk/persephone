# US-348: LinkEditor Refactoring — Browser Removal, Context Menus

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.3b
**Depends on:** US-346, US-349, US-350
**Status:** Planned

## Goal

Remove the browser selector from LinkEditor toolbar. Refactor link context menus to use the `treeProviderContextMenu` event channel pattern for flexible, type-aware menu item generation.

## Background

### What's already done (US-344 through US-350)

- `ILink` is the unified type, `LinkItem extends ILink` with required `id`
- `LinksList`/`LinksTiles` are view-only components accepting `ILink[]` with callback props
- `LinkItemList`/`LinkItemTiles` are thin wrappers wiring `LinkViewModel` to `LinksList`/`LinksTiles`
- Pin indicator works via `getAdditionalIcon` callback
- Drag-drop works via `dragType`/`getDragItem` callbacks
- `CategoryView` uses `LinksList`/`LinksTiles` for rendering

### Browser selector removal

The browser selector toolbar button (`selectedBrowser` dropdown) is unused — users right-click any link to choose browser/profile/incognito via `appendLinkOpenMenuItems()` (already in `src/renderer/editors/shared/link-open-menu.tsx`).

### Context menu event channel pattern

The existing 3-layer pattern from `TreeProviderViewModel` and `tree-context-menus.tsx`:

1. **Layer 1 (Generic):** Component adds base items (Copy Path, Rename, Delete)
2. **Layer 2 (Event Channel):** `app.events.linkContextMenu.sendAsync()` — registered handlers add type-specific items based on href (file items get "Open in New Tab", etc.)
3. **Layer 3 (Parent Callback):** `onContextMenu` prop — parent adds/overrides items

Currently `registerTreeContextMenuHandlers()` handles file paths (non-HTTP). For HTTP links we need a new handler that adds browser open items.

The current `LinkItemList`/`LinkItemTiles` build context menus entirely inline using `appendLinkOpenMenuItems`. Refactoring to the event channel pattern means:
- Link-specific items (Edit, Copy URL, Pin, Delete) stay inline in the wrapper
- Type-specific items (Open in Browser for HTTP, Open in New Tab for files) come from registered event channel handlers
- This is more extensible — scripts can subscribe to add custom items, and the same HTTP handler works in Explorer and Archive too

## Implementation Plan

### Step 0: Rename `treeProviderContextMenu` → `linkContextMenu`

**File:** `src/renderer/api/events/AppEvents.ts`

Rename channel and update type parameter:
```typescript
// Before:
readonly treeProviderContextMenu = new EventChannel<ContextMenuEvent<ITreeProviderItem>>({ name: "treeProviderContextMenu" });
// After:
readonly linkContextMenu = new EventChannel<ContextMenuEvent<ILink>>({ name: "linkContextMenu" });
```

**File:** `src/renderer/content/tree-context-menus.tsx` — update `app.events.treeProviderContextMenu` → `app.events.linkContextMenu`

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` — update `app.events.treeProviderContextMenu` → `app.events.linkContextMenu`

3 files, 3 references. Aligns with the "Everything is a Link" vision — the channel handles context menus for any `ILink`, not just tree provider items.

### Step 1: Remove browser selector from LinkEditor

**File:** `src/renderer/editors/link-editor/LinkEditor.tsx`

Remove from toolbar portal:
- `showBrowserSelectorMenu` callback and the `Button` that renders it
- `getBrowserSelectorIcon` / `getBrowserSelectorLabel` helper functions
- `browserProfiles` from `settings.use("browser-profiles")`
- `initBrowserSelection()` `useEffect`
- Unused imports: `GlobeIcon`, `OpenFileIcon` (check if used elsewhere in file), `IncognitoIcon`, `DEFAULT_BROWSER_COLOR`, `BrowserProfile`

**Keep** in `LinkViewModel`: `selectedBrowser`, `openLink()`, `setSelectedBrowser()`, `initBrowserSelection()` — used by BookmarksDrawer and context menu actions.

### Step 2: Register HTTP link context menu handler

**File:** `src/renderer/content/tree-context-menus.tsx` (modify)

Add a handler for HTTP/HTTPS links (alongside the existing file handler):

```typescript
// HTTP link handler — for URLs
app.events.treeProviderContextMenu.subscribe(async (event) => {
    const item = event.target;
    if (!item) return;
    if (!item.href.startsWith("http://") && !item.href.startsWith("https://")) return;

    const { appendLinkOpenMenuItems } = await import("../editors/shared/link-open-menu");
    appendLinkOpenMenuItems(event.items, item.href, { startGroup: true });
});
```

This ensures that ANY ILink with an HTTP href — whether in Explorer, Archive, or Link collections — gets "Open in Browser" context menu items automatically.

### Step 3: Refactor context menus in LinkItemList/LinkItemTiles

**Files:** `src/renderer/editors/link-editor/LinkItemList.tsx`, `src/renderer/editors/link-editor/LinkItemTiles.tsx`

The `handleContextMenu` callback currently builds the entire menu inline. Refactor to:

1. Add link-specific items (Edit, Copy URL, Copy Image URL, Pin/Unpin, Delete) — **Layer 1**
2. Dispatch to `app.events.linkContextMenu.sendAsync()` — **Layer 2** adds type-aware items (browser open for HTTP, file open for local paths)
3. Set `e.nativeEvent.contextMenuPromise` so the global popup waits for async handlers

```typescript
const handleContextMenu = useCallback((e: React.MouseEvent, link: ILink) => {
    model.selectLink(link.id!);
    const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "link-item");
    ctxEvent.target = link;

    // Layer 1: Link-specific items
    const customItems = model.onGetLinkMenuItems?.(link as LinkItem);
    if (customItems?.length) {
        ctxEvent.items.push(...customItems);
    }
    ctxEvent.items.push(
        { label: "Edit", icon: <RenameIcon />, onClick: () => model.showLinkDialog(link.id!),
          startGroup: customItems?.length ? true : undefined },
    );
    ctxEvent.items.push(
        { label: "Copy URL", icon: <CopyIcon />,
          onClick: () => { if (link.href) clipboard.writeText(link.href); },
          disabled: !link.href },
    );
    if (link.imgSrc) {
        ctxEvent.items.push(
            { label: "Copy Image URL", icon: <CopyIcon />,
              onClick: () => clipboard.writeText(link.imgSrc!), startGroup: true },
        );
    }
    const isPinned = model.isLinkPinned(link.id!);
    ctxEvent.items.push(
        { label: isPinned ? "Unpin" : "Pin",
          icon: isPinned ? <PinFilledIcon /> : <PinIcon />,
          onClick: () => model.togglePinLink(link.id!), startGroup: true },
        { label: "Delete", icon: <DeleteIcon />,
          onClick: () => model.deleteLink(link.id!) },
    );

    // Layer 2: Event channel — type-aware items
    e.nativeEvent.contextMenuPromise = app.events.linkContextMenu.sendAsync(
        ctxEvent as ContextMenuEvent<ILink>,
    );
}, [model]);
```

**Remove:** `appendLinkOpenMenuItems` import and direct calls — now handled by event channel handler.

### Step 4: Verify BookmarksDrawer compatibility

After removing the browser selector, verify the BookmarksDrawer layout works. The `swapLayout` prop check that conditionally hid the browser selector is no longer needed.

## Concerns — All RESOLVED

### 1. Search stays as-is

LinkEditor keeps its own search. No changes.

### 2. Context menu ordering

Link-specific items (Edit, Copy, Pin, Delete) are added first (Layer 1). Then the event channel handler adds type-specific items (Open in Browser, Open in New Tab). This means browser-open items appear after link management items — reasonable ordering.

### 3. `onGetLinkMenuItems` callback

`LinkViewModel.onGetLinkMenuItems` is used by BookmarksDrawer to prepend "Open in New Tab" items. This stays — it's called before the event channel, giving BookmarksDrawer priority.

## Acceptance Criteria

- [ ] Browser selector removed from LinkEditor toolbar
- [ ] HTTP link context menu handler registered in `tree-context-menus.tsx`
- [ ] LinkItemList/LinkItemTiles use event channel for context menus
- [ ] `appendLinkOpenMenuItems` no longer called directly in link editor wrappers
- [ ] Context menus show correct items: Edit, Copy URL, Pin, Delete + type-aware items
- [ ] BookmarksDrawer context still works
- [ ] No visual regressions
- [ ] No TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/events/AppEvents.ts` | Rename `treeProviderContextMenu` → `linkContextMenu`, type `ILink` |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Update channel reference |
| `src/renderer/content/tree-context-menus.tsx` | Update channel reference, register HTTP link handler |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Remove browser selector, clean up toolbar and imports |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Refactor context menu to event channel pattern |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Refactor context menu to event channel pattern |

### Files NOT changed

- `src/renderer/editors/link-editor/LinkViewModel.ts` — keep `openLink`, `selectedBrowser`, `initBrowserSelection` (BookmarksDrawer)
- `src/renderer/editors/link-editor/LinkTreeProvider.ts` — not involved
- `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` — unchanged (has its own context menu)
- `src/renderer/editors/link-editor/LinksList.tsx` / `LinksTiles.tsx` — unchanged
- `src/renderer/editors/shared/link-open-menu.tsx` — unchanged, reused via event channel handler
