# EPIC-018: Secondary Editors — Content Applications

**Status:** Planned
**Created:** 2026-04-02
**Depends on:** EPIC-016 (core infrastructure, completed), EPIC-017 (PageContainer, planned)

## Overview

Build concrete secondary editor applications on top of the infrastructure established in EPIC-016. This includes replacing the standalone Link editor with a secondary editor-based design, integrating Browser bookmarks and DOM resource browsing, and expanding archive format support beyond ZIP.

This epic was split from EPIC-016 after Phase 1 (Architecture Foundation) was completed. The remaining phases are collected here. Some tasks may be simplified or redesigned after EPIC-017 (PageContainer Architecture) lands.

## Goals

- Replace the standalone Link editor with LinksPageModel + LinksSecondaryEditor
- Add Browser editor integration with secondary panels
- Support additional archive formats via libarchive-wasm
- Build reusable secondary editor components (TreeProviderItemTile, content search)
- Prototype non-tree secondary editors (RegexSecondaryEditor)

## Phases

### Phase 1: Link Editor Replacement

| # | Task | Title | Description | Depends on | Status |
|---|------|-------|-------------|------------|--------|
| 1.1 | — | LinksPageModel + LinksSecondaryEditor | LinksPageModel (link-view editor) sets `secondaryEditor = "link-category"`. Secondary component renders decrypt button (if encrypted) + collapsible Categories/Tags/Hostnames panels. Implements ITreeProvider for category browsing. Uses existing pipe for encrypted files. Overrides `beforeNavigateAway()` to survive when navigated page was opened from this collection. | — | Planned |
| 1.2 | — | Tags/Hostnames sub-panels in LinksSecondaryEditor | Inner panels: Tags panel (`provider.hasTags`), Hostnames panel (`provider.hasHostnames`). Uses `CollapsiblePanelStack`. | 1.1 | Planned |
| 1.3 | — | Pinned items panel in CategoryView | Shown when `provider.pinnable`. Calls `getPinnedItems()`, `pin()`, `unpin()`. | 1.1 | Planned |
| 1.4 | — | TreeProviderItemTile component | Tile renderer for CategoryView. Shows `imgSrc` for links, image preview for images. | — | Planned |
| 1.5 | — | `.link.json` browsing via secondary editor | User opens `.link.json` → link-view editor sets `secondaryEditor = "link-category"`. CategoryView shows link items. Encrypted files handled by existing decrypt flow. Switching to monaco clears `secondaryEditor`. | 1.1–1.4 | Planned |
| 1.6 | — | Non-HTTP links in link collections | Local file paths and cURL commands as link items. Type-based icons. | 1.5 | Planned |
| 1.7 | — | Verify Link editor feature parity | Test: pinned links, view modes, drag-drop, edit/delete, context menus. | 1.5 | Planned |
| 1.8 | — | Decommission standalone Link editor | Remove registration, delete old components. | 1.7 | Planned |

### Phase 2: Browser & Advanced Features

| # | Task | Title | Description | Depends on | Status |
|---|------|-------|-------------|------------|--------|
| 2.1 | — | Browser editor integration | Replace embedded LinkEditor with secondary editor panels. Event channel pattern for link opening. | 1.1 | Planned |
| 2.2 | — | Multi-file drop to .link.json | Create temp `.link.json` in cache, open as page with LinksPageModel. | 1.5 | Planned |
| 2.3 | — | DOMSecondaryEditor | Secondary editor for HTML content (TextPageModel). Scrapes DOM resources. Categories: images, scripts, styles, media. | — | Planned |
| 2.4 | — | Content search for LinksPageModel | Instant in-memory search by title/href/tags. | 1.1 | Planned |
| 2.5 | — | Expose LinkTreeProvider in script `io` namespace | `io.LinkTreeProvider`. Script type definitions. | 1.1 | Planned |
| 2.6 | — | RegexSecondaryEditor (prototype) | Secondary editor for TextPageModel. Regex input + match highlighting in monaco. Example of non-tree secondary editor. | — | Planned |

### Phase 3: Archive Expansion

| # | Task | Title | Description | Depends on | Status |
|---|------|-------|-------------|------------|--------|
| 3.1 | — | Adopt libarchive-wasm | Replace `jszip` with `libarchive-wasm` (WASM-based, MIT) in archive-service. Supports RAR v4/v5, 7z, TAR, gzip, bzip2, lzma/xz, cab, ISO. Generalize `ZipTreeProvider` to `ArchiveTreeProvider`. Update `ARCHIVE_EXTENSIONS` and `isArchiveFile()`. | — | Planned |

## Notes

### 2026-04-02
- Split from EPIC-016 (Phases 2, 3, 4 moved here as Phases 1, 2, 3)
- Planned to implement after EPIC-017 (PageContainer Architecture)
- Some tasks may be simplified by PageContainer (e.g., navigation survival, owner tracking)
- Task US-IDs will be assigned when work begins
