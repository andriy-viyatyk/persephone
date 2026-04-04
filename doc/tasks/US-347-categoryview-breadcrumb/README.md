# US-347: CategoryView / CategoryEditor Breadcrumb

**Epic:** [EPIC-018](../../epics/EPIC-018.md) (enhancement, not assigned to a specific phase task)
**Status:** Planned

## Goal

Add an optional breadcrumb to CategoryView that shows the current category path and allows navigating to any ancestor by clicking. This benefits all CategoryView consumers: Explorer folder view, Archive folder view, and Link collection folder view.

## Background

### Current state

- CategoryView has one toolbar portal (`toolbarPortalRef`) rendering search + view mode toggle
- CategoryEditor creates a `PageToolbar` with a single portal target for CategoryView's toolbar
- The `Breadcrumb` component (`src/renderer/components/basic/Breadcrumb.tsx`) already exists and supports "/" separators
- LinkEditor has its own breadcrumb (context-dependent: Categories/Tags/Hostnames) — this is separate and stays in LinkEditor

### What the breadcrumb shows

For a CategoryView displaying `category = "Bookmarks/Tech/AI"`:
```
All > Bookmarks > Tech > AI
```

Clicking "Bookmarks" navigates to `category = "Bookmarks"` via `onFolderClick`.

The root label comes from the provider's `displayName` or a simple "All".

### No ITreeProvider changes needed

The breadcrumb value is just the `category` prop string. Clicking a segment calls the existing `onFolderClick` callback with a synthetic directory item. No new provider methods required.

## Implementation Plan

### Option A: Breadcrumb inside CategoryView

Add a `breadcrumbRootLabel?: string` prop to CategoryView. When set, render a Breadcrumb above the item list (or portal it to a new `breadcrumbPortalRef`).

### Option B: Breadcrumb in CategoryEditor

CategoryEditor already knows the category path. Render Breadcrumb directly in PageToolbar, alongside the existing portal target.

**Recommendation:** Option B is simpler for now — CategoryEditor owns the breadcrumb and navigates via the existing `openRawLink` mechanism. No CategoryView prop changes needed. Can be promoted to CategoryView later if LinkEditor's inline mode also wants it.

## Acceptance Criteria

- [ ] CategoryEditor shows a breadcrumb with the current category path
- [ ] Clicking a breadcrumb segment navigates to that category
- [ ] Root click navigates to the provider's root
- [ ] Works for all providers (File, Zip, Link)
- [ ] No regressions in CategoryView rendering

## Files Changed (estimated)

| File | Change |
|------|--------|
| `src/renderer/editors/category/CategoryEditor.tsx` | Add Breadcrumb to PageToolbar |
