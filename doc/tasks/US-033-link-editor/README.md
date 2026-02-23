# US-033: Link Editor

## Status

**Status:** Completed
**Priority:** Medium
**Started:** 2026-02-23
**Completed:** 2026-02-23
**Depends on:** —
**Depended on by:** US-028 (Browser Bookmarks)

## Summary

A structured link manager editor for `.link.json` files. Similar in layout to the Notebook editor — left panel with categories and tags, center area with links displayed in multiple view modes (list, tiles). Includes an edit/create link dialog designed for future reuse as a browser bookmark dialog.

## Why

- Provides organized link storage with categories and tags — bookmarks, reference links, video collections, etc.
- Prerequisite for US-028 (Browser Bookmarks): the bookmark flow will save links into `.link.json` files
- Tile view with images enables visual browsing of video/media link collections
- Reusable edit dialog prepares the foundation for browser "Save Bookmark" functionality

## Data Format

### File: `.link.json`

```json
{
  "links": [
    {
      "id": "lk-1",
      "title": "Example Video",
      "href": "https://example.com/video/123",
      "category": "Videos/Tutorials",
      "tags": ["dev", "react"],
      "imgSrc": "https://example.com/thumb/123.jpg"
    }
  ],
  "state": {
    "categoryViewMode": {
      "Videos/Tutorials": "tiles-landscape",
      "Documentation": "list"
    },
    "tagViewMode": {
      "react": "tiles-portrait"
    }
  }
}
```

### LinkItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier (e.g., `lk-1`) |
| `title` | string | yes | Display title |
| `href` | string | yes | URL |
| `category` | string | yes | Category path (e.g., `"Videos/Tutorials"`) |
| `tags` | string[] | yes | Tag list |
| `imgSrc` | string | no | Preview image URL for tile view |

No `createdDate`/`updatedDate` — not needed for link management.

### State

View mode stored per-category in `state.categoryViewMode` and per-tag in `state.tagViewMode`:
- `"list"` — default
- `"tiles-landscape"` — normal landscape tiles
- `"tiles-landscape-big"` — big landscape tiles
- `"tiles-portrait"` — normal portrait tiles
- `"tiles-portrait-big"` — big portrait tiles

## Acceptance Criteria

- [x] `.link.json` files open in the Link Editor
- [x] Left panel with categories tree and tags list (reused components)
- [x] Category and tag filtering works
- [x] List view: "open link" button with icon swap, edit/delete action buttons, context menu with open options
- [x] Tile views: 4 variants (landscape/portrait, normal/big) with image or "no image" placeholder
- [x] View mode remembered per category and per tag (stored in file's `state`)
- [x] View mode switcher in toolbar with custom icons
- [x] Edit/Create Link dialog with all fields + image preview
- [x] Dialog supports image selection area (for future browser bookmark integration)
- [x] Search/filter links by title or URL
- [x] Quick-add option for new links
- [x] Editor registered in `register-editors.ts` with `.link.json` extension
- [x] Distinctive file icon for `.link.json`
- [x] Delete confirmation with Ctrl+click bypass
- [x] Double-click to edit in both list and tile views
- [x] Selection overlay using pseudo-elements (semi-transparent)
- [x] Context menu: Copy Image URL and Open Image in New Tab (when imgSrc set)
- [x] "Links" in quick-add page menu (PageTabs dropdown)
- [x] `openImageInNewTab` extracted to shared `page-actions.ts`
- [x] Documentation updated
- [x] No regressions in existing functionality

## Technical Approach

### Reusable Components (from existing codebase)

These components already exist in `/src/renderer/components/` and will be reused directly:

| Component | Location | Usage |
|-----------|----------|-------|
| `CategoryTree` | `components/TreeView/CategoryTree.tsx` | Left panel category tree |
| `TagsList` | `components/basic/TagsList.tsx` | Left panel tag filter |
| `CollapsiblePanelStack` | `components/layout/CollapsiblePanelStack.tsx` | Categories/Tags panel switcher |
| `Splitter` | `components/layout/Splitter.tsx` | Left panel resize |
| `RenderGrid` | `components/virtualization/RenderGrid/RenderGrid.tsx` | Virtualized grid for list and tile views |
| `PathInput` | `components/basic/PathInput.tsx` | Category/tag editing in dialog |

### New Files

| File | Description |
|------|-------------|
| `editors/link-editor/linkTypes.ts` | `LinkItem`, `LinkEditorData`, view mode types |
| `editors/link-editor/LinkEditorModel.ts` | Model class — filtering, CRUD, state management |
| `editors/link-editor/LinkEditorView.tsx` | Main view — toolbar, left panel, content area |
| `editors/link-editor/LinkItemList.tsx` | List view mode component |
| `editors/link-editor/LinkItemTiles.tsx` | Tile view mode component (all 4 variants) |
| `editors/link-editor/EditLinkDialog.tsx` | Create/edit link popup dialog |

### Layout

```
┌──────────────────────────────────────────────┐
│ Toolbar: [+ Add] [Search...] [View Mode ▼]  │
├──────────┬───┬───────────────────────────────┤
│ Tags     │   │                               │
│  All (N) │ S │  Link list or tile grid       │
│  dev (n) │ p │                               │
│  react(n)│ l │  [List View]                  │
│ ──────── │ i │   🔗 Title          [✎] [▼]  │
│ Category │ t │   🔗 Title          [✎] [▼]  │
│  ▸ Root  │ t │                               │
│    ▸ Sub │ e │  [Tile View]                  │
│          │ r │   ┌──────┐ ┌──────┐ ┌──────┐ │
│          │   │   │ img  │ │ img  │ │ no   │ │
│          │   │   │      │ │      │ │ img  │ │
│          │   │   │Title │ │Title │ │Title │ │
│          │   │   └──────┘ └──────┘ └──────┘ │
└──────────┴───┴───────────────────────────────┘
```

### Edit Link Dialog

Built using the app's existing dialog pattern (`showConfirmationDialog` / popup overlay).

```
┌─ Edit Link ──────────────────────────────┐
│                                          │
│  Title:    [________________________]    │
│  URL:      [________________________]    │
│  Category: [_________ ▾ autocomplete]    │
│  Tags:     [tag1] [tag2] [+ add]         │
│  Image URL:[________________________]    │
│                                          │
│  ┌── Image Preview ───────────────────┐  │
│  │                                    │  │
│  │   (preview of imgSrc if provided)  │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌── Discovered Images (new link) ────┐  │
│  │  [img1] [img2] [img3]  (select)   │  │
│  └────────────────────────────────────┘  │
│                                          │
│              [Cancel]  [Save]            │
└──────────────────────────────────────────┘
```

The **Category** and **Tags** fields use the same editing pattern as in the Notebook editor's `NoteItemView`:
- **Category**: `PathInput` component with autocomplete from existing categories in the file
- **Tags**: Tag chips with inline add/edit/delete, autocomplete from existing tags in the file

The "Discovered Images" section appears only when creating a new link from the browser bookmark flow. It receives an array of candidate image URLs from the browser, and the user picks one (which populates `imgSrc`). When editing an existing link, only the single image preview is shown.

### Open Options Menu

The "open options" dropdown on each link item:
- **Open in Default Browser** — `shell.openExternal(href)`
- **Open in Internal Browser** — `openUrlInBrowserTab(href)`
- **Open in Profile...** — submenu with available profiles
- **Open in Incognito** — `openUrlInBrowserTab(href, { incognito: true })`
- **Copy URL** — copy `href` to clipboard
- **Edit** — open edit dialog
- **Delete** — delete with confirmation

## Implementation Progress

### Phase 1: Types & Model
- [x] Define `LinkItem`, `LinkEditorData`, view mode types in `linkTypes.ts`
- [x] Create `LinkEditorModel` with CRUD operations, filtering by category/tag, search
- [x] Register `.link.json` in `register-editors.ts`
- [x] Add file icon for `.link.json`

### Phase 2: Main View & List Mode
- [x] Create `LinkEditorView` with toolbar, left panel (CategoryTree + TagsList), splitter
- [x] Implement list view in `LinkItemList.tsx`
- [x] Link click opens in default browser; edit and open-options buttons
- [x] View mode stored per category in file state

### Phase 3: Tile Views
- [x] Implement `LinkItemTiles.tsx` with 4 tile variants
- [x] Image display with fallback "no image" placeholder
- [x] View mode switcher in toolbar

### Phase 4: Edit Link Dialog
- [x] Create `EditLinkDialog.tsx` with all fields
- [x] Image preview when `imgSrc` is provided
- [x] Discovered images selection area (empty for now — populated by browser in US-028)
- [x] Reuse for both create and edit flows

### Phase 4b: UI/UX Enhancements
- [x] List row height reduced from 32px to 28px for denser layout
- [x] Custom `OpenLinkIcon` — filled "share/forward" curved arrow icon in `icons.tsx`
- [x] List view: "Open link" Button with icon swap — GlobeIcon (default) → OpenLinkIcon (on hover)
- [x] Tile view: OpenLinkIcon used for "open link" action in tile title bar
- [x] Selection overlay in list view — `::after` pseudo-element with `color.background.selection` at 0.3 opacity (replaces solid background)
- [x] Selection overlay in tile view — `::before` pseudo-element with same style (in addition to existing border highlight)
- [x] Delete confirmation dialog — `showConfirmationDialog` with "Delete"/"Cancel" buttons
- [x] Ctrl+click bypass — holding Ctrl when clicking delete button skips confirmation
- [x] Title visual separation in list view — rounded border (`color.border.default`) around link title
- [x] Double-click to edit — opens edit dialog in both list and tile views
- [x] Context menu — Edit, Open in Default Browser, Open in Internal Browser, Open in Incognito, Copy URL, Delete
- [x] Context menu — Copy Image URL, Open Image in New Tab (conditional on imgSrc)
- [x] View mode icons — 5 custom icons (ViewListIcon, ViewLandscapeIcon, etc.) in menu and toolbar
- [x] View mode per tag — separate `tagViewMode` storage, panel-aware get/set
- [x] Focus restoration after dialog close — `containerElement` pattern on model
- [x] Focus restoration after popup menu — universal fix in `showAppPopupMenu`
- [x] Compact edit dialog — reduced gap/padding/button panel
- [x] Tag field placeholder — "Type + Enter to add"
- [x] Title field uses `TextAreaField` with `singleLine` — auto-grows for long titles
- [x] `openImageInNewTab` extracted to `page-actions.ts` (shared by Link Editor and Browser Editor)
- [x] "Links" added to quick-add page menu in PageTabs

### Phase 5: Documentation
- [x] Add Link Editor to user docs (`docs/editors.md`)
- [x] Update `docs/whats-new.md`
- [x] Update architecture docs if needed

## Notes

### 2026-02-23 — UI/UX Polish Session
- List row height: 32px → 28px for denser layout
- New `OpenLinkIcon` in `icons.tsx` — filled "share/forward" curved arrow (`d="M14 4l6 5-6 5V10c-5 0-9 2-11 7 1-7 5-11 11-12V4z"`)
- List view icon area: static GlobeIcon → Button component with GlobeIcon/OpenLinkIcon swap on hover
- Tile view: uses OpenLinkIcon for open-link action in title bar
- Selection style: replaced solid `backgroundColor` with `::after`/`::before` pseudo-element overlays (`color.background.selection`, opacity 0.3, `pointerEvents: "none"`)
- Delete confirmation: `showConfirmationDialog` with "Delete"/"Cancel"; Ctrl+click bypasses dialog (both views)
- Title separation in list view: added `border: 1px solid color.border.default`, `borderRadius: 4`, `padding: "0 6px"` around title text
- Double-click opens edit dialog in both list and tile views
- Context menu items: Edit, Open in Default Browser, Open in Internal Browser, Open in Incognito, Copy URL, Delete

### 2026-02-23
- Created as a prerequisite for US-028 (Browser Bookmarks)
- Layout mirrors Notebook editor — reuses CategoryTree, TagsList, CollapsiblePanelStack, Splitter
- Use `RenderGrid` (not `RenderFlexGrid`) — all views have fixed row heights, no auto-adjustment needed
- For tile views, compute `colCount = floor(gridWidth / cellWidth)` and map `row * colCount + col` to the flat links array
- No createdDate/updatedDate fields — not useful for link management
- Edit dialog designed with "discovered images" section for future browser bookmark integration (US-028 will populate it)
- View mode is per-category to allow different layouts for different collections (e.g., list for documentation links, tiles for video collections)

## Reference Implementation

- **Tile grid with `RenderGrid`**: `D:\projects\av-player\src\renderer\pages\links\LinksView.tsx` — demonstrates the tile rendering pattern: dynamic column count from container width, `row * colCount + col` index mapping, `onResize` callback for responsive layout

## Related

- Depended on by: [US-028 Browser Bookmarks](../US-028-browser-bookmarks/README.md)
- Similar to: [US-009 Notebook Editor](../US-009-notebook-editor/) (layout and component reuse)
