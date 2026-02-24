# US-034: Link Editor Enhancement

## Status

**Status:** In Progress
**Started:** 2026-02-24
**Priority:** Medium

## Summary

Enhance the Link Editor with favicon display, drag-and-drop for links and categories, and a pinned links panel.

## Why

- Links lack visual identity — favicons make scanning and recognition much faster
- Category management is manual — drag-and-drop (matching Notebook editor UX) makes reorganization natural
- Frequently used links need quick access — a pinned links panel provides a persistent shortcut area

## Acceptance Criteria

- [ ] Favicons fetched and cached per site hostname in `data/cache-misc/favicons/`
- [ ] Favicon displayed next to each link in list and tile views
- [ ] Links can be dragged onto categories to reassign them
- [ ] Categories can be dragged onto other categories to make subcategories (with confirmation)
- [ ] Links can be pinned/unpinned via context menu
- [ ] Pinned links panel shown at the right edge (left edge in Browser-integrated mode)
- [ ] Pinned panel shows favicon + title only, is resizable via Splitter
- [ ] Pinned panel hidden when no links are pinned
- [ ] Pinned links can be reordered by dragging within the panel
- [ ] Documentation updated
- [ ] No regressions in existing Link Editor functionality

## Technical Approach

### Feature 1: Favicon Caching & Display

**Cache location:** `{userData}/data/cache-misc/favicons/{hostname}.ico`

The `cache-misc` folder is a new general-purpose cache directory (separate from the existing `cache` folder which stores page/editor state). Favicons are stored by hostname, e.g., `www.youtube.com.ico`.

**Integration with `files-store.ts`:**

All `cache-misc` operations go through `filesModel` in `src/renderer/store/files-store.ts`. This follows the existing pattern where `cachePath` and `dataPath` are resolved from `api.getCommonFolder("userData")` and exposed via helper methods.

Add to `FilesModel`:
- `cacheMiscPath: string | null` — initialized in `internalInit()` as `path.join(this.dataPath, "cache-misc")`
- Expose via `defaultFilesModelState` for reactive access (same as `cachePath`)
- `getCacheMiscFile(subPath)` / `saveCacheMiscFile(subPath, content)` / `deleteCacheMiscFile(subPath)` — helpers that resolve `path.join(cacheMiscPath, subPath)` and delegate to existing `getFile` / `saveFile` / `deleteFile`
- For binary files (favicons are binary), add `saveBinaryFile(filePath, buffer)` / `getBinaryFile(filePath)` using `nodeUtils` (or raw `fs`) since current methods are string-only

This keeps all file path resolution centralized and ensures the correct `userData` folder is used in both dev and prod modes.

**Favicon source — Browser editor:**
- The Browser already displays favicons on internal tabs via `page-favicon-updated` webview event (provides favicon URL or data URL)
- On navigation, check if `{hostname}.ico` file exists in cache → if not, write the already-available favicon data to disk via `filesModel`
- **Only save from default profile and named user profiles** — never save from incognito mode (incognito should leave no trace on disk)
- Reading cached favicons is always allowed (incognito can display previously cached favicons, just not write new ones)

**Favicon cache utility (`favicon-cache.ts`):**
- New utility module `src/renderer/editors/link-editor/favicon-cache.ts`
- `saveFavicon(hostname, dataOrUrl)` — check if file exists, if not write to `cache-misc/favicons/{hostname}.ico` via `filesModel`
- `getFaviconPath(hostname) → string | null` — return cached file path if exists, null otherwise
- In-memory Map for already-resolved hostnames (avoids repeated disk checks within a session)

**Display in Link Editor:**
- For each link, extract hostname from `href`, call `getFaviconPath(hostname)`
- If cached favicon exists — display it (16×16 or 20×20, inline before the title)
- If not — show default globe icon as fallback

### Feature 2: Drag-and-Drop for Links & Categories

Follow the exact pattern from Notebook editor (`react-dnd`):

**Drag types (add to `linkTypes.ts`):**
```typescript
export const LINK_DRAG = "LINK_DRAG";
export const LINK_CATEGORY_DRAG = "LINK_CATEGORY_DRAG";
```

**Link drag → Category drop:**
- Drag source: link item indicator/icon in `LinkItemList` / tile views (using `useDrag`)
- Drop target: category tree items in the sidebar (using `useDrop` on TreeView)
- On drop: update `link.category` to the target category path
- Visual feedback: highlight category on hover (same as Notebook)

**Category drag → Category drop:**
- Drag source: category tree items (via `getDragItem` returning `LINK_CATEGORY_DRAG`)
- Drop target: other category tree items
- On drop: dragged category becomes subcategory of target
- **All links** in the dragged category (and its subcategories) have their `category` path updated
- Confirmation dialog: "Move N link(s) from 'X' to 'Y/X'?"
- Root "All" category is not draggable (return `null` from `getDragItem`)

**Model methods (add to `LinkEditorModel`):**
- `categoryDrop(dropItem, dragItem)` — dispatch based on drag type
- `getCategoryDragItem(item)` — returns drag item or null
- `moveCategory(fromCategory, toCategory)` — reparent with confirmation
- `moveLinkToCategory(linkId, category)` — reassign single link

### Feature 3: Pinned Links Panel

**Data model — ordered ID array in `state`:**
```typescript
export interface LinkEditorData {
    links: LinkItem[];
    state: {
        // ... existing fields ...
        pinnedLinks?: string[];  // Ordered array of pinned link IDs
    };
}
```

No changes to `LinkItem` — pinned state is a view/layout concern, not a property of the link itself. The array order defines display order in the panel.

**Operations:**
- **Pin:** push link ID to end of `state.pinnedLinks`
- **Unpin:** filter ID out of `state.pinnedLinks`
- **Reorder:** splice within the array
- **Delete link:** also filter its ID from `state.pinnedLinks`

**Context menu additions:**
- "Pin" (when not pinned) / "Unpin" (when pinned)
- Pinned icon displayed on the link row/tile

**Pinned panel:**
- Positioned at the right edge of the Link Editor (swapped to left in Browser-integrated `swapLayout` mode)
- Shows only pinned links: favicon + title (no href)
- Resizable via Splitter component
- Hidden entirely when `pinnedLinks` is empty or undefined (no empty panel)
- Links displayed in `pinnedLinks` array order
- Drag-to-reorder within the panel (splice the array)

**Panel implementation:**
- New component `PinnedLinksPanel` — a vertical list inside a Splitter pane
- Uses `react-dnd` for internal reordering (similar to how sortable lists work)
- Clicking a pinned link triggers the same action as clicking in the main list (open URL)

## Files to Modify

### New Files
- `src/renderer/editors/link-editor/favicon-cache.ts` — Renderer-side favicon fetching & disk caching utility
- `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` — Pinned links panel component

### Modified Files
- `src/renderer/store/files-store.ts` — Add `cacheMiscPath`, binary file helpers, `getCacheMiscFile`/`saveCacheMiscFile`/`deleteCacheMiscFile`
- `src/renderer/editors/link-editor/linkTypes.ts` — Add drag type constants, `pinnedLinks` to state
- `src/renderer/editors/link-editor/LinkEditorModel.ts` — Drag-drop handlers, pin/unpin, favicon loading
- `src/renderer/editors/link-editor/LinkEditor.tsx` — Layout with Splitter for pinned panel, drag-drop context
- `src/renderer/editors/link-editor/LinkItemList.tsx` — Favicon display, drag source on links, pin icon
- `src/renderer/editors/link-editor/LinkItemTiles.tsx` — Favicon display, drag source on tiles, pin icon
- `src/renderer/editors/link-editor/EditLinkDialog.tsx` — Possibly show favicon in edit dialog

## Implementation Progress

### Phase 1: Favicon Caching & Display
- [x] Add `cacheMiscPath` and binary file helpers to `files-store.ts`
- [x] Create `favicon-cache.ts` utility (`saveFavicon`, `getFaviconPath`, in-memory map)
- [x] Save favicons from Browser editor on `page-favicon-updated` (skip incognito)
- [x] Display favicon in `LinkItemList` (replace globe icon, fallback to globe)
- [x] Display favicon in `LinkItemTiles`
- [x] Display favicon in `EditLinkDialog` — skipped, low value (dialog already shows URL + image preview)

### Phase 2: Drag-and-Drop
- [x] Add drag type constants to `linkTypes.ts`
- [x] Add `useDrag` on link items in `LinkItemList`
- [x] Add `useDrop` on TreeView categories (configure `dropTypes`, `onDrop`, `getDragItem`)
- [x] Implement `categoryDrop`, `moveLinkToCategory` in `LinkEditorModel`
- [x] Implement `moveCategory` with confirmation dialog in `LinkEditorModel`
- [x] Add drag source for tiles in `LinkItemTiles`
- [x] Visual feedback (drag opacity, drop highlight)

### Phase 3: Pinned Links Panel
- [x] Add `pinnedLinks` array to `LinkEditorData.state`
- [x] Add pin/unpin to link context menu
- [x] Show pinned icon on pinned links in list/tile views
- [x] Create `PinnedLinksPanel` component
- [x] Integrate panel into `LinkEditor` layout with Splitter
- [x] Handle `swapLayout` (right edge normally, left edge in Browser)
- [x] Auto-hide panel when no pinned links
- [x] Implement drag-to-reorder within pinned panel
- [x] Clicking pinned link opens URL (same behavior as main list)

## Notes

### Design Decisions
- `cache-misc` is a new top-level cache folder separate from the existing `cache` (which stores page state). This keeps concerns separated and makes cache cleanup easier.
- Favicon filenames use the full hostname (e.g., `www.youtube.com.ico`) for simplicity — no hashing needed since hostnames are valid filenames.
- Drag-and-drop follows the Notebook editor pattern exactly (`react-dnd`, `useDrag`/`useDrop`, `NOTE_DRAG`/`CATEGORY_DRAG` constants, confirmation dialogs) for UX consistency.
- Pinned links use an ordered ID array (`pinnedLinks: string[]`) in `LinkEditorData.state` — simpler than per-link `pinOrder` fields. Reorder splices within the array. Panel width persisted as `pinnedPanelWidth`.
- Favicon fetching in main process avoids CORS restrictions that would apply in the renderer.

## Related

- Related task: [US-033 Link Editor](../US-033-link-editor/README.md) — original Link Editor implementation
- Related task: [US-028 Browser Bookmarks](../US-028-browser-bookmarks/README.md) — Browser integration with Link Editor
- Related pattern: [US-022 ToDo Editor](../US-022-todo-editor/README.md) — drag-and-drop in Notebook editor (US-009)
- Related doc: [Coding Style](../../standards/coding-style.md)
