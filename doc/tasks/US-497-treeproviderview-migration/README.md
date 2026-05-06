# US-497: TreeProviderView — UIKit Tree migration

## Status

**Ready for review** — plan resolved, awaiting user confirmation before
implementation. Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4.

## Goal

Migrate `components/tree-provider/TreeProviderView` from the legacy
`components/TreeView` + `components/basic/TextField` + `components/basic/Button`
implementation to UIKit primitives (`Tree`, `Input`, `IconButton`).
**Public API of `TreeProviderView` stays stable** — all six consumers across
sidebar and editors keep working without changes.

This is the last sidebar-shared component still on legacy chrome. After this
task closes, the entire Sidebar (and every editor that consumes
`TreeProviderView`) is on UIKit.

## Background

### Current implementation

`TreeProviderView` is a thin shell over the legacy `TreeView` plus a
collapsible search field. Most logic lives in `TreeProviderViewModel`:

- **Tree data** — `displayTree: TreeProviderNode | null`, computed from the
  raw `tree` plus search filter (deep ≥ 3 chars, shallow < 3) and the
  `showLinks` flag
- **Lazy children** — `buildTree` lists root, leaves directories' children
  `undefined` until first expansion; `loadChildrenIfNeeded(href)` lists on
  demand; `loadChildrenForPaths` preloads many paths (used at init for
  restored expansion state, and during `revealItem`)
- **Refresh** — `provider.watch(callback)` rebuilds; preserves currently
  expanded paths
- **Search** — `searchVisible` + `searchText`; deep mode forces
  `defaultExpandAll`; saved-and-restored expand map between deep ↔ shallow
- **Context menu** — async chain across three layers: built-in items, event
  channel `app.events.linkContextMenu.sendAsync`, parent's `onContextMenu`.
  Wired via `e.nativeEvent.contextMenuPromise` so `GlobalEventService` waits
  for async handlers before showing the menu
- **Drag-drop** — `traitTypeId={TraitTypeId.ILink}` when `provider.writable`,
  `getDragData/canTraitDrop/onTraitDrop` plumbed through `TreeView`
- **Reveal item** — computes ancestor paths via `fpDirname` loop, preloads
  children for ancestors, then expands each + scrolls
- **State persistence** — `getState() => { expandedPaths }` from
  `treeViewRef.getExpandMap()`; restored at mount via `initialState`

### Files in scope

| File | Change |
|------|--------|
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Rewrite — internal swap from `TreeView` to UIKit `Tree`, `TextField`/`Button` to UIKit `Input`/`IconButton`. Public API stable. |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Adjust ref type (`TreeViewRef` → `TreeRef`), update method names where the interface differs (`getExpandMap` → `getExpandedMap`, `scrollToItem`/`expandItem` already match); drop `treeViewKey` if no longer needed (replaced by Tree's revision-based memo). |
| `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx` | No changes — icon resolver stays. |
| `src/renderer/components/tree-provider/index.ts` | No changes. |

### Files NOT in scope

- `src/renderer/components/TreeView/` — keep. `CategoryTree` (used by
  `NotebookEditor` and `RestClientEditor`) still depends on `TreeView`.
  Removal is a future task once those consumers migrate.
- `src/renderer/components/basic/TextField` and
  `src/renderer/components/basic/Button` — used elsewhere; only
  `TreeProviderView`'s imports of them are removed.
- `src/renderer/components/tree-provider/CategoryView*.tsx` and
  `favicon-cache.ts` — sibling files in the same folder, not consumers of
  `TreeProviderView`. Untouched.
- All six consumer files (see table below) — public API of
  `TreeProviderView` is preserved, so they need no changes.

### Consumer surface — must keep working

| Consumer | Surface | API uses |
|----------|---------|----------|
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | Sidebar — script library tree | `provider`, `initialState`, `onStateChange`, `onItemClick`, `ref` |
| `src/renderer/ui/sidebar/MenuBar.tsx` | Sidebar — custom-folder right rail | `provider`, `initialState`, `onStateChange`, `onItemClick`, `ref.refresh()`, `ref.showSearch()` |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Editor — Explorer panel | `provider`, `selectedHref`, `onItemClick`, `onItemDoubleClick`, `onContextMenu`, `initialState`, `onStateChange`, `ref.refresh()`, `ref.collapseAll()`, `ref.revealItem(href)` |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Editor — Link editor categories | `provider`, `showLinks`, `selectedHref`, `onItemClick`, `onContextMenu`, `getLabel`, `rootLabel` |
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | Editor — Archive viewer | `provider`, `onItemClick`, `onItemDoubleClick`, `ref.refresh()`, `ref.collapseAll()` |
| `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` | Editor — Archive secondary | `provider`, `selectedHref`, `onItemClick`, `onItemDoubleClick`, `ref.revealItem(href)` |

### UIKit Tree summary (target primitive)

UIKit `Tree<T>`:
- `items: T[] | Traited<unknown[]>` + optional `getChildren(source)` — walks
  source items via `TREE_ITEM_KEY` trait (`value`, `label`, `icon`,
  `disabled`, `section`, `items`)
- `value` / `onChange(source)` — single selection. `onChange` fires on click
  or Enter (when `keyboardNav: true`)
- `searchText` — built-in label highlight when label is a string
- `defaultExpandedValues: Record<value, boolean>` — initial expansion hints
- `defaultExpandAll: boolean` — when true, every node is expanded on first
  build (used during deep search)
- `traitTypeId / getDragData / acceptsDrop / canTraitDrop / onTraitDrop` —
  drag-drop (signature adds `level` arg, additive over current callbacks)
- `getHasChildren / loadChildren / getAncestorValues` — lazy children
  (US-489); not used in this migration since `TreeProviderViewModel` already
  preloads via its own pipeline
- `renderItem(ctx)` — custom row renderer with `source`, `level`, `selected`,
  `active`, etc.
- `TreeRef`: `scrollToItem(value, align?)`, `revealItem(value, align?)`,
  `expandItem(value)`, `toggleItem(value)`, `expandAll()`, `collapseAll()`,
  `getExpandedMap()`

## Implementation plan

### Step 0 — Extend UIKit Tree with `onItemDoubleClick`

`src/renderer/uikit/Tree/types.ts`, `Tree.tsx`, `TreeModel.ts`

UIKit Tree currently has no double-click hook. Add one to the primitive:

1. **`types.ts`** — add to `TreeProps<T>`:

   ```ts
   /**
    * Fires when the user double-clicks a row. Emits the source `T` and the row's
    * level. Section and disabled rows do not fire — same gate as `onChange`.
    */
   onItemDoubleClick?: (source: T, level: number) => void;
   ```

2. **`TreeModel.ts`** — add a handler symmetric to `onItemClick`:

   ```ts
   onItemDoubleClick = (rowIndex: number) => {
       const r = this.rows.value[rowIndex];
       if (!r || r.item.disabled || r.item.section) return;
       this.props.onItemDoubleClick?.(r.source, r.level);
   };
   ```

3. **`Tree.tsx`** — wire `onDoubleClick` onto the row wrapper alongside the
   existing `onClick`:

   ```tsx
   onClick={() => model.onItemClick(idx)}
   onDoubleClick={() => model.onItemDoubleClick(idx)}
   ```

   Add `onItemDoubleClick: _onItemDoubleClick` to the unused-destructure
   block at the top of the View (it is captured via `this.props` like the
   other handlers).

4. **`Tree.story.tsx`** — small demo addition is optional; not required
   for behavior parity. Skip unless trivially small.

This keeps section / disabled gating consistent with `onChange` and gives
all current and future Tree consumers a clean primitive hook.

### Step 1 — TreeProviderViewModel.tsx adjustments

`src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

1. Replace ref type: `TreeViewRef` → `TreeRef` (from
   `../../uikit/Tree/types`). Drop the `import { TreeItem, TreeViewRef }
   from "../TreeView"` line. Keep `TreeItem<T>` interface declaration (used
   to extend `TreeProviderNode`); inline the minimal shape since `TreeView`
   is no longer imported.
2. Rename `treeViewRef` field → `treeRef` for clarity (internal rename, no
   public exposure).
3. Adjust method calls:
   - `treeViewRef.getExpandMap()` → `treeRef.getExpandedMap()` (UIKit name)
   - `treeViewRef.expandItem(p)` → `treeRef.expandItem(p)` (same name)
   - `treeViewRef.scrollToItem(href)` → `treeRef.scrollToItem(href)` (same)
   - `treeViewRef.toggleItem(href)` → `treeRef.toggleItem(href)` (same)
4. `getExpandedMap` returns `Record<string|number, boolean>` (UIKit) vs.
   the legacy `Record<string, boolean>`. Cast / iterate via `Object.keys` —
   `String(key)` to match `TreeProviderViewSavedState.expandedPaths: string[]`.
5. `revealItem(href)` simplification:

   ```ts
   revealItem = async (href: string) => {
       // ... (existing ancestor-path loop computes `allPaths`)
       await this.loadChildrenForPaths(allPaths);          // unchanged
       await new Promise((r) => setTimeout(r, 0));         // unchanged
       await this.treeRef?.revealItem(href);               // replaces the
       // expandItem-loop + scrollToItem; UIKit Tree's revealItem expands
       // ancestors that are present in the loaded tree, then scrolls.
   };
   ```
6. Remove `treeViewKey` from state — UIKit Tree memo re-walks on every input
   change, so no force remount is needed for content updates. The deep ↔
   shallow search remount is handled by an outer `key` prop on `<Tree>`
   (Step 2).
7. `onItemClick` keeps its current behavior (toggle directory + forward
   item click). UIKit Tree's `onChange` fires on click — the View wires
   `onChange={model.onItemClick}` (with the source `TreeProviderNode`).
8. `dispose()` unchanged — `watchSubscription?.unsubscribe()` is the only
   resource.

### Step 2 — TreeProviderView.tsx rewrite

`src/renderer/components/tree-provider/TreeProviderView.tsx`

Full rewrite. Outline:

1. **Imports** — replace:
   - `import { TreeView } from "../TreeView/TreeView"` →
     `import { Tree, TREE_ITEM_KEY } from "../../uikit/Tree"`
   - `import { TreeViewRef } from "../TreeView"` →
     `import type { TreeRef, TreeItemRenderContext } from "../../uikit/Tree"`
   - `import { TextField } from "../basic/TextField"` and
     `import { Button } from "../basic/Button"` →
     `import { Input, IconButton } from "../../uikit"`
   - Keep `import { highlightText } from "../basic/useHighlightedText"`
     (used in default `getLabel`, still works) OR replace with UIKit Tree's
     built-in `searchText` highlight (preferred — drops one legacy import).
     **Decision below in C7.**
   - Drop `import { LINK } from "..."` and `resolveTraits` — drag-drop
     callbacks unchanged, but `canTraitDrop` keeps the same closure body.

2. **Trait set** — define a per-row trait at module scope:

   ```ts
   import { TraitSet, traited } from "../../core/traits/traits";
   import { TREE_ITEM_KEY } from "../../uikit/Tree";

   const tpvNodeTraits = new TraitSet().add(TREE_ITEM_KEY, {
       value: (node: unknown) => (node as TreeProviderNode).data.href,
       label: (node: unknown) => (node as TreeProviderNode).data.title,
       icon: (node: unknown) => (
           <TreeProviderItemIcon item={(node as TreeProviderNode).data} />
       ),
       items: (node: unknown) => (node as TreeProviderNode).items,
   });
   ```

   The `items` accessor is read by `Tree` to walk children; alternatively
   use `getChildren` on the Tree prop — pick whichever is cleaner during
   implementation. Both produce the same memo behavior.

3. **Chrome wrapper** — keep a small `<div>` root with `tabIndex={0}` for
   container-level Ctrl+F / Escape (chrome exception — `tree-provider/` is
   shared, but the keyboard wiring is unique to this view, so Emotion is
   acceptable here OR replace with UIKit `Panel` + raw key handlers).
   **Decision below in C5.**

4. **Tree wiring**:

   ```tsx
   <Tree<TreeProviderNode>
       key={searchKey}                   // forces remount on deep ↔ shallow boundary
       ref={treeRef}
       items={tNodes}                    // traited([displayTree], tpvNodeTraits)
       value={selectedNode}              // resolved by isSelected, or null
       isSelected={getSelected}          // existing predicate
       onChange={model.onItemClick}
       searchText={state.searchText}
       defaultExpandedValues={initialExpanded}
       defaultExpandAll={isDeepSearch}
       onExpandChange={model.onExpandChange}
       getHasChildren={getHasChildren}   // existing predicate (unchanged)
       traitTypeId={writable ? TraitTypeId.ILink : undefined}
       getDragData={writable ? getDragData : undefined}
       acceptsDrop={writable}
       canTraitDrop={writable ? canTraitDrop : undefined}
       onTraitDrop={writable ? onTraitDrop : undefined}
       renderItem={renderItem}
   />
   ```

   `searchKey` mirrors the legacy `treeViewKey` — bumped only on deep ↔
   shallow boundary in `setSearchText`.

5. **renderItem** — needed for raw context menu (per C6 below) and for the
   custom `getLabel` path. Double-click is now handled at Tree level via
   `onItemDoubleClick` (Step 0). Wraps UIKit `<TreeItem>`:

   ```tsx
   const renderItem = useCallback((ctx: TreeItemRenderContext<TreeProviderNode>) => {
       const node = ctx.source;
       return (
           <TreeItem
               id={ctx.id}
               level={ctx.level}
               expanded={ctx.expanded}
               hasChildren={ctx.hasChildren}
               icon={<TreeProviderItemIcon item={node.data} />}
               label={getLabelContent(node)}    // string OR JSX from props.getLabel
               searchText={state.searchText}
               selected={ctx.selected}
               active={ctx.active}
               dragging={ctx.dragging}
               dropActive={ctx.dropActive}
               loading={ctx.loading}
               tooltip={node.data.href}         // hover tooltip — was `title=` attr
               onChevronClick={ctx.toggleExpanded}
               onContextMenu={(e) => model.onItemContextMenu(node, e)}
           />
       );
   }, [state.searchText, props.getLabel, model]);
   ```

   Where `getLabelContent(node)` returns:
   - `props.getLabel?.(node.data, state.searchText)` when set (LinkCategoryPanel
     custom JSX — replaces the legacy `<span className="tpv-item-label">`
     wrapper),
   - else `node.data.title` (plain string — UIKit highlights via
     `searchText`).

6. **Search row** — Input + IconButton:

   ```tsx
   {state.searchVisible && (
       <Panel direction="row" padding="xs" data-type="tpv-search">
           <Input
               ref={searchInputRef}
               size="sm"
               value={state.searchText}
               onChange={model.setSearchText}
               placeholder="Search..."
               onKeyDown={handleSearchKeyDown}
               onBlur={handleSearchBlur}
               endSlot={state.searchText && (
                   <IconButton
                       size="sm"
                       title="Close Search"
                       icon={<CloseIcon />}
                       onClick={handleSearchClose}
                   />
               )}
           />
       </Panel>
   )}
   ```

   The legacy `border-top: 1px solid border.light` is preserved by
   `<Panel>`'s border-top variant — confirm Panel supports a top-border
   prop or extend with `borderTop` prop, otherwise keep a thin chrome
   `<div>` (chrome exception applies — `tree-provider/` is sidebar-adjacent
   shared chrome).

7. **Error / empty states** — UIKit `Panel` + `Text`:

   ```tsx
   if (state.error) {
       return (
           <Panel padding="md">
               <Text size="sm" color="error">{state.error}</Text>
           </Panel>
       );
   }
   if (!state.displayTree) {
       return (
           <Panel padding="md">
               <Text size="sm" color="light">No content</Text>
           </Panel>
       );
   }
   ```

8. **Imperative ref** — drop unused `getScrollTop` / `setScrollTop` per C2.
   Map remaining methods:

   ```ts
   const refValue: TreeProviderViewRef = {
       refresh: model.buildTree,
       showSearch: () => {
           model.showSearch();
           setTimeout(() => searchInputRef.current?.focus(), 0);
       },
       hideSearch: () => {
           model.hideSearch();
           rootRef.current?.focus();
       },
       collapseAll: () => {
           treeRef.current?.collapseAll();
           props.onStateChange?.({ expandedPaths: [] });
       },
       getState: model.getState,
       revealItem: model.revealItem,
   };
   ```

   `TreeProviderViewRef` interface in this file drops the two scrollTop
   methods. Public-API-compat note: no consumers call them, so the removal
   is safe.

### Step 3 — verify consumers

After Steps 1-2, walk each consumer file. **No changes expected** for:

- `ScriptLibraryPanel.tsx`, `MenuBar.tsx`, `ExplorerSecondaryEditor.tsx`,
  `LinkCategoryPanel.tsx`, `ArchiveEditorView.tsx`,
  `ArchiveSecondaryEditor.tsx`

If any consumer holds a reference of type `TreeProviderViewRef` and calls
`.getScrollTop()` / `.setScrollTop()` (none currently do — verified via
grep), drop the call. Otherwise, no code edits.

### Step 4 — manual smoke

For each surface:

- **ScriptLibraryPanel** — open library, expand/collapse, drag-and-drop,
  search (deep + shallow), reveal, refresh
- **MenuBar custom folders** — open menu, expand folder, search via
  Ctrl+F, refresh
- **Explorer panel** — root navigation, reveal-on-selection, refresh,
  collapse all, context menu (Make Root, Search in Folder)
- **Link editor categories** — categories-only mode, links mode, custom
  label rendering with size badge + tooltip, context menu (Edit Link)
- **Archive viewer** — open archive, expand entries, refresh, collapse all
- **Archive secondary editor** — reveal-on-selection

## Concerns — resolved

**C1. UIKit Tree has no native double-click event.**
**Resolved:** extend the UIKit `Tree` primitive with `onItemDoubleClick?:
(source: T, level: number) => void`. Symmetric to `onChange` — same
section/disabled gate, wired onto the row wrapper alongside `onClick`.
This is a small, principled addition: UIKit is our library, and the right
answer to "primitive doesn't expose what the consumer needs" is to extend
the primitive, not work around it. See Step 0.

**C2. `getScrollTop` / `setScrollTop` on `TreeProviderViewRef` are unused
externally.**
**Resolved:** drop them. `git grep` confirms no consumer calls them. Public
ref interface contracts to the methods that are actually used.

**C3. Search depth deep ↔ shallow remount.**
**Resolved:** keep the existing remount pattern — `key={searchKey}` on
`<Tree>`, bumped in `setSearchText` when `wasDeep !== isDeep`. UIKit Tree
owns expansion state after first render, so changing `defaultExpandAll`
mid-flight without remount has no effect.

**C4. Legacy TreeView's `level < 2` auto-expand vs UIKit Tree's strict
`defaultExpandAll`.**
**Resolved:** the existing `buildAllCollapsedMap` pipeline already overrides
the level-based behavior with explicit `{ root: true, others: false }` when
no saved state exists. Pass that map through `defaultExpandedValues`. No
behavior change.

**C5. Container-level Ctrl+F / Escape handling.**
**Resolved:** keep a thin outer `<div ref={rootRef} tabIndex={0}
onKeyDown={...}>` for Ctrl+F intercept. UIKit Tree's `keyboardNav` is for
Arrow / Enter navigation INSIDE the tree — orthogonal to Ctrl+F at the
container level. The wrapper div is chrome (a single styled.div with one
`{ display: flex, flexDirection: column, height: 100%, outline: none }`
block — acceptable chrome exception, since `tree-provider/` lives outside
`src/renderer/uikit/` and the wiring is unique to this view).

**C6. Async context menu (`contextMenuPromise`) vs UIKit Tree's sync
`getContextMenu(item, level)`.**
**Resolved:** bypass Tree's per-row context-menu API. Attach
`onContextMenu` directly inside `renderItem` (UIKit `<TreeItem>` accepts
it via `...rest`). The model's existing `onItemContextMenu` builds the
generic items, calls `app.events.linkContextMenu.sendAsync`, and sets
`e.nativeEvent.contextMenuPromise` — unchanged. Tree's container-level
`onContextMenu` short-circuits when `contextMenuEvent.items.length > 0`,
so background context-menu handling (`onBackgroundContextMenu` for
"New File / New Folder") flows correctly.

**C7. `getLabel` consumer override (used by LinkCategoryPanel) — how to
wire through UIKit Tree.**
**Resolved:** in `renderItem`, branch on `props.getLabel`. When set, pass
`props.getLabel(node.data, searchText)` (JSX) as the `label` prop of UIKit
`<TreeItem>` — UIKit accepts `React.ReactNode`. When unset, pass
`node.data.title` (plain string) and let UIKit's built-in `searchText`
highlight do its thing. Drops the legacy `highlightText` import in
TreeProviderView itself (LinkCategoryPanel keeps it for its own custom
label rendering).

**C8. Legacy chrome (`tpv-tree { paddingLeft: 4 }`, `tpv-empty`,
`tpv-error`).**
**Resolved:** drop `paddingLeft: 4` — UIKit Tree already indents via
`indentSize`. Replace `tpv-error` / `tpv-empty` with UIKit `<Panel>` +
`<Text>`. Replace `tpv-search` border-top with UIKit `<Panel>` chrome (or
a thin `borderTop` if Panel doesn't expose a top-only border prop —
acceptable chrome exception either way).

**C9. `revealItem` flow.**
**Resolved:** keep the model-side ancestor-path computation +
`loadChildrenForPaths` (data preload), then delegate the final
expand-and-scroll to `treeRef.revealItem(href)`. UIKit Tree's revealItem
walks the loaded tree, expands ancestors found, and scrolls. No need to
implement `getAncestorValues` (the deferred-load resolver) — preload is
synchronous from the consumer's POV.

**C10. Click on directory toggles expansion + fires `onItemClick`.**
**Resolved:** UIKit Tree's `onChange` fires on click; toggle is on chevron
only by default. Wire `onChange={model.onItemClick}` — the model's
existing handler calls `treeRef.toggleItem(node.data.href)` for
directories AND fires `props.onItemClick(node.data)` for all items.
Behavior parity preserved.

**C11. `onItemDoubleClick` for directories — currently fires
`props.onFolderDoubleClick`, for files `props.onItemDoubleClick`. **
**Resolved:** the model's `onItemDoubleClick` keeps the same branch logic.
The View wires `onDoubleClick` inside `renderItem` to call
`model.onItemDoubleClick(node)` — model decides which prop to fire.

**C12. `treeViewKey` field in state.**
**Resolved:** demote to a local `searchKey` ref or include in state as
`searchKey` — used purely as a remount trigger on deep ↔ shallow boundary.
No other consumers of the field. Cleaner than the current model-level
state slot.

## Sequencing relative to US-492

**Open question to confirm with user:**

- **If US-497 must complete before US-492** — sidebar testing waits for
  full UIKit migration (recommended for "everything migrated" parity).
- **If US-497 may run after US-492** — testing of the four list-level
  migrations (US-479, US-490, US-491, US-495, US-496) proceeds while
  TreeProviderView stays on legacy chrome.

The plan does not block on this — implementation can start regardless.

## Acceptance criteria

- [ ] All six consumers compile and render without code changes.
- [ ] No imports of `components/TreeView`, `components/basic/TextField`,
  or `components/basic/Button` remain in
  `src/renderer/components/tree-provider/`.
- [ ] Manual smoke (Step 4) passes for every surface: expand/collapse,
  selection, click navigation, double-click open, context menu (with async
  Edit Link / Make Root etc. items), drag-and-drop, search (deep +
  shallow), reveal-on-selection, refresh, collapseAll.
- [ ] Saved expand state survives app restart (settings round-trip via
  `TreeProviderViewSavedState`).
- [ ] No regressions in existing keyboard shortcuts (Ctrl+F to focus
  search, Escape to close search).
- [ ] `npm run lint` clean.

## Files Changed

| File | Type | Purpose |
|------|------|---------|
| `src/renderer/uikit/Tree/types.ts` | Modify | Add `onItemDoubleClick?: (source: T, level: number) => void` to `TreeProps<T>`. |
| `src/renderer/uikit/Tree/TreeModel.ts` | Modify | Add `onItemDoubleClick(rowIndex)` handler — section/disabled gate symmetric with `onItemClick`. |
| `src/renderer/uikit/Tree/Tree.tsx` | Modify | Wire `onDoubleClick` on row wrapper; destructure `onItemDoubleClick` into the unused-prop block (captured via `this.props`). |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Modify | Internal rewrite — UIKit `Tree` + `Input` + `IconButton`. Public API stable. |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Modify | Ref type swap (`TreeViewRef` → `TreeRef`), method-name updates (`getExpandMap` → `getExpandedMap`), drop `treeViewKey` from state, simplify `revealItem` to delegate to `treeRef.revealItem`. |
| `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx` | No change | Icon resolver remains. |
| `src/renderer/components/tree-provider/index.ts` | No change | Barrel exports stable. |

## Files NOT changed

| File | Why |
|------|-----|
| Six consumer files (see Consumer surface table) | Public API stable. Verified: no consumer calls `getScrollTop`/`setScrollTop`. |
| `src/renderer/components/TreeView/` | Still used by `CategoryTree` (notebook + rest-client). |
| `src/renderer/components/basic/TextField/` and `.../Button/` | Still used elsewhere. |
| `src/renderer/components/tree-provider/CategoryView*.tsx`, `favicon-cache.ts` | Sibling files; unrelated to the Tree migration. |
| `src/renderer/uikit/Tree/*` | Already in place from US-485/488/489. No primitive extension needed. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Underlying primitive: US-485 (UIKit Tree — completed); US-488 (Tree DnD);
  US-489 (Tree lazy children)
- Related: [US-495](../US-495-scriptlibrarypanel-migration/README.md) —
  ScriptLibraryPanel (consumer of TreeProviderView, untouched here)
