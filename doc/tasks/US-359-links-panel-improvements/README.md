# US-359: Links Panel Improvements

**Epic:** EPIC-018 (Phase 2)
**Status:** Done
**Created:** 2026-04-05

## Goal

Improve the "Links" sidebar panel with tooltips, context menus, proper navigation, and inline content support.

## Changes Implemented

### 1. Rich tooltips for link items
`LinkCategoryPanel` renders a shared `Tooltip` with `render` callback. Non-directory items get `data-tooltip-*` attributes. Shows title, href (truncated, scrollable), image preview, and a copy-as-JSON button.

### 2. "Edit Link" context menu
Added `onContextMenu` handler via `TreeProviderView.onContextMenu` prop. Non-directory items get "Edit Link" → `vm.showLinkDialog(item.id)`.

### 3. Navigation routing fix (HTTP URLs via pipe)
`navigatePageTo` and `open-handler` now pass the content pipe through to `createEditorFromFile`. Previously HTTP URLs navigated to empty pages because the pipe was disposed.

### 4. `ILink.target` field + `ILinkMetadata.fallbackTarget`
- `ILink.target` — preferred editor for the link (e.g., `"image-view"` for images)
- `ILinkMetadata.fallbackTarget` — panel-level default when URL has no recognized extension (e.g., `"monaco"`)
- `LinkCategoryPanel` passes `item.target` as RawLinkEvent target, `fallbackTarget: "monaco"` in metadata
- HTTP resolver checks `fallbackTarget` before falling back to browser

### 5. `ILinkMetadata.title` field
New `title` field passed through the pipeline to `navigatePageTo` → sets page title before `restore()`. Enables title-based language detection for data: URLs.

### 6. Editor target resolution in `navigatePageTo`
Added `target` option + `newEditorModelByTarget()` method. Image URLs with `target: "image-view"` now open in image viewer instead of Monaco.

### 7. Language detection from title
`TextFileIOModel.restore()` now falls back to title extension when filePath extension yields no language match. General improvement — works for all pages, not just Links panel.

### 8. DataUrlProvider + data: URL pipeline
New `DataUrlProvider` decodes `data:` URLs (base64 and percent-encoded). Registered in provider registry, parser, and link-utils. Enables inline content (scripts, styles) to flow through the standard content pipeline.

### 9. Inline script/style extraction
`extractHtmlResources()` collects `<script>` (no src) and `<style>` blocks as `data:` URLs. Titles like `script-block-1 (2.3 KB).js`. 1MB size limit. Deduplicated by content.

### 10. Title preservation for data: URLs
`TextFileIOModel.restore()` preserves pre-set title instead of overwriting with `fpBasename(filePath)` when filePath yields empty basename.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Tooltip, context menu, selection highlight, target/fallbackTarget/title in metadata |
| `src/renderer/content/providers/DataUrlProvider.ts` | **New.** IProvider for data: URLs |
| `src/renderer/content/registry.ts` | Register "data" provider |
| `src/renderer/content/parsers.ts` | Add data: URL parser |
| `src/renderer/content/link-utils.ts` | Handle data: URLs in resolveUrlToPipeDescriptor |
| `src/renderer/content/resolvers.ts` | Check fallbackTarget in HTTP resolver |
| `src/renderer/content/open-handler.ts` | Pass pipe + target + title to navigatePageTo |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | navigatePageTo: pipe/target/title options; createEditorFromFile: target/title params; newEditorModelByTarget |
| `src/renderer/editors/text/TextFileIOModel.ts` | Language detection from title; title preservation |
| `src/renderer/core/utils/html-resources.ts` | Inline scripts/styles; imgSrc for images; deduplication |
| `assets/editor-types/io.tree.d.ts` | ILink.target field |
| `src/renderer/api/types/io.tree.d.ts` | Same (keep in sync) |
| `assets/editor-types/io.events.d.ts` | ILinkMetadata.title + fallbackTarget |
| `src/renderer/api/types/io.events.d.ts` | Same (keep in sync) |
