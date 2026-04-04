# US-352: Clean Up and Unify Link Actions

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.7
**Status:** Planned

## Goal

Unify double-click behavior across all link views: double-click opens the link (navigates), not the edit dialog. Remove the separate "open" button from list and tile views. Remove dead code from the refactoring. Mark tasks 1.5 and 1.6 as done (verified, no changes needed).

## Implementation Plan

### Step 1: Change double-click to open link in LinkItemList/LinkItemTiles

**Files:** `src/renderer/editors/link-editor/LinkItemList.tsx`, `src/renderer/editors/link-editor/LinkItemTiles.tsx`

Pass `onDoubleClick={handleOpen}` to `LinksList`/`LinksTiles`. This overrides the default behavior (which calls `onEdit`):

```typescript
// In LinkItemList:
<LinksList
    ...
    onDoubleClick={handleOpen}  // add this
    onEdit={handleEdit}         // keep for action button
    ...
/>
```

Same for `LinkItemTiles`.

### Step 2: Change double-click in PinnedLinksPanel

**File:** `src/renderer/editors/link-editor/PinnedLinksPanel.tsx`

Change line 195:
```typescript
// Before:
onDoubleClick={() => model.showLinkDialog(link.id)}
// After:
onDoubleClick={() => { if (link.href) model.openLink(link.href); }}
```

Also remove the separate open button from the pinned item rendering (the button that calls `model.openLink`).

### Step 3: Remove open button from LinksList

**File:** `src/renderer/editors/link-editor/LinksList.tsx`

Remove from `LinksListRow`:
- The `link-open-btn` Button (favicon + open icon overlay)
- The `onOpen` prop handling in the button click
- The `link-open-btn`, `icon-open`, `icon-open-bg` styles from `LinksListRoot`

Replace with a plain icon display (TreeProviderItemIcon is still needed for the row icon):
```tsx
<span className="link-icon">
    <TreeProviderItemIcon item={link} />
</span>
```

Remove `onOpen` from `LinksListRowProps` and `LinksListProps`.

### Step 4: Remove open button from LinksTiles

**File:** `src/renderer/editors/link-editor/LinksTiles.tsx`

Remove from `LinksTileCell`:
- The `tile-open-link` span (the open link icon in the title area)
- The `onOpen` prop handling
- The `tile-open-link` styles from `LinksTilesRoot`

Remove `onOpen` from `LinksTileCellProps` and `LinksTilesProps`.

### Step 5: Update CategoryView callbacks

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

CategoryView already passes `onDoubleClick` to `LinksList`/`LinksTiles`. Remove the `onOpen` prop since it's no longer in the interface.

### Step 6: Remove dead code

**File:** `src/renderer/components/tree-provider/ItemTile.tsx` — delete entirely (no longer imported anywhere after US-349)

Check for any other unused imports or exports.

## Acceptance Criteria

- [ ] Double-click opens the link in all contexts (LinkItemList, LinkItemTiles, PinnedLinksPanel)
- [ ] Separate "open" button removed from list rows and tile cards
- [ ] Edit dialog accessible via context menu "Edit" and action button (hover)
- [ ] `ItemTile.tsx` removed (dead code)
- [ ] No regressions in CategoryView (Explorer, Archive)
- [ ] No TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Pass `onDoubleClick={handleOpen}` |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Pass `onDoubleClick={handleOpen}` |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | Double-click opens link, remove open button |
| `src/renderer/editors/link-editor/LinksList.tsx` | Remove open button + styles, remove `onOpen` prop |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | Remove open button + styles, remove `onOpen` prop |
| `src/renderer/components/tree-provider/CategoryView.tsx` | Remove `onOpen` prop |
| `src/renderer/components/tree-provider/ItemTile.tsx` | **Delete** (dead code) |
