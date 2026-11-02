# US-1748: Editor categories for pinned editors

## Goal

Replace the single pinned editor list with ordered named categories. Add a categorized new-tab popover and replace the Built-in / Registered boards pages with a shared Editors tree beside a category manager. This is a standalone task with no epic.

## Background

- `src/renderer/api/settings.ts` declares `pinned-editors` as `string[]`, defaults it from `DEFAULT_PINNED_EDITORS`, and applies `migrateLegacyPinnedEditors()` (`draw-view` → `bundled-board:excalidraw`). `src/renderer/ui/sidebar/pinned-items.ts` owns the existing ref encoding: editor IDs and `board:<absolute root>` strings. Scripts can read/write arbitrary settings through `settings.get`/`settings.set`; the setting is described in `src/renderer/scripting/ai-vision/namespaces/settings.ts` and `assets/guides/scripting/api/settings.md`. Reusing the old key with an object would silently break array-reading scripts, so the category model uses a new key and removes the old one after migration.
- `getCreatableItems()` in `src/renderer/ui/sidebar/tools-editors-registry.ts` is the built-in catalog, including tools, browser profiles, and enabled bundled boards. `getDisabledBundledBoardItems()` is a separate management-only list. Trusted board roots come from `boardTrust.listPaths()`; every trusted board is eligible, including file-associated (`file-viewer`) boards. Categories use the current `PinnedRef` encoding for both creatable IDs and trusted `board:<root>` refs.
- `src/renderer/editors/board/boards-tree-build.ts` exports `BoardTreeNode` and `buildBoardsTree()`. `src/renderer/editors/board/BoardsTreeView.ts` renders that board tree through `TreeView`, including folder/board icons, open behavior, trailing update/pin controls, and board context menus. `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` renders creatable rows and delegates bundled-board Enable/Disable to `getBundledBoardContextMenu()` in `tools-editors-registry.ts`. `src/renderer/ui/sidebar/TrustedBoardsListView.ts` supplies board open, update, copy path, open board folder, remove/untrust, update tag, and eligible-pin actions.
- `ToolsHubEditor.ts` currently persists `HubTab` values `builtin`, `boards`, `search`, `tools`, and `site-extensions`. `ToolsHubView` places a vertical `PinnedRailView` beside the tab column on every hub tab. `ToolsEditorsPanelView` has Built-in, Boards, Tools tabs and a horizontal `PinnedRailView`. A source search finds `PinnedRailView` used only by those two compositions, `BuiltinEditorsListView` only by `ToolsEditorsPanelView` and `PinnedRailView`, and `TrustedBoardsListView` only by `ToolsEditorsPanelView`; retire these three views when their replacement is connected. Keep `BoardsTreeView` because other editor surfaces use it.
- `PageTabsView.updateAddMenu()` supplies flat `MenuItem[]` to `SplitButtonView`. Other split-button consumers are Git pull and the Explorer board action. Add an optional callback path without changing those callers or the primary click. `PopoverView` has a native `contentView(host)` factory; its content view must adopt/use the supplied host. `TreeProps` drag/drop names are `traitTypeId`, `getDragData`, `acceptsDrop`, `canTraitDrop`, and `onTraitDrop`; Tree only treats rows as drop targets (no row means no drop). `SplitterView` exists and supports `orientation`, `value`, `min`, `max`, and `onChange`, so the hub can use a resizable 50/50 split.
- UI strings use flat `<area>.<entryName>` keys and `t(key)`. New English keys intentionally fall back to English in the 17 packs under `assets/languages/`; do not add English copies to those packs. UIKit remains catalog-independent; these app-owned views use shell catalog keys.
- The SSDA `ConfigureColumnsPopover.tsx` and its CSS were inspected only as layout references. Recreate its column-flow layout in Persephone; do not reuse its component, data, or domain strings.

### Decisions

- Top has fixed ID `top`; its displayed label comes from localization, its stored `name` is ignored, and it cannot be renamed, deleted, or reordered. It always renders first.
- Persist categories under the new `editor-categories` key with shape `{ id: string; name: string; items: string[] }[]`. Top is first and has `id: "top"`. On load when the new key is absent, map old `pinned-editors` through `migrateLegacyPinnedEditors()` and place the resulting ordered refs into Top; if the old key is absent, use `DEFAULT_PINNED_EDITORS`. Persist the new value and remove `pinned-editors`. A new key preserves the old key's array contract for external scripts during the transition rather than changing its value shape in place.
- Membership is exclusive: each pinnable ref occurs in at most one category. The eligible surface is all `getCreatableItems()` plus every trusted board root. Keep stale refs in storage but do not render them. Disabled bundled boards are never category members or popover/Other choices. File-associated boards are included (user decision during testing): they all open without a file from Tools & Editors, and boards such as Audio Player and Agent Log Viewer are useful that way, so the old pin rule's `file-viewer` exclusion is dropped. Disabled bundled boards remain visible only as management rows in the merged Editors tree so their existing Enable action is reachable.
- Deleting a user category makes its members uncategorized; they appear in Other. Confirm deletion only if it has items. This avoids silently inflating Top.
- Stored category order is display order. User category blocks reorder by dragging their headers; Top remains fixed. Items reorder by dragging within/across category blocks. Other is derived from eligible unassigned items in Editors-tree order (Built-in first, then trusted boards).
- The full hub has no Pinned rail on any tab. `builtin` and `boards` restore to `editors`; all other valid tabs remain unchanged. The Editors tab has the fully expanded editor tree on the left and Categories on the right. The splitter stores the Categories pane width in pixels and clamps it to 30–70% of the hub width. An Editors-tab-only name filter sits at the right of the hub tab row; matching folders retain all their boards. Tree rows show a bordered category chip and an accent Update chip when applicable. The sidebar panel merges Built-in and Boards into Editors using the same tree, removes its horizontal Pinned rail, and keeps Tools as its own tab. Category CRUD is hub-only; the plus popover is the quick list.
- Use one app-owned `EditorCategoryColumnListView` and CSS for the shared category-and-item column-flow treatment, instantiated by both `EditorCategoriesView` and `EditorCategoriesPopoverView`. This keeps the popover and manager visually consistent while leaving `PopoverView` and uikit catalog-free.

## Implementation Plan

### Progress

- [x] Storage key, legacy migration, category types, and CRUD/membership helpers
- [x] Shared category column list and manager
- [x] Merged Editors tree and hub/sidebar integration
- [x] New-tab popover and additive SplitButton callback
- [x] Localization, guides, architecture documentation, and data-name hooks
- [x] Requested verification commands (`typecheck`, `lint`, `build-prod`)

### 1. Storage, migration, and scripting contract

In `src/renderer/api/settings.ts`, declare `editor-categories` as `EditorCategory[]`, define/export `EditorCategory = { id: string; name: string; items: string[] }`, seed Top with the default refs, update the settings description, and add a migration in the settings-load normalization path after `migrateLegacyPinnedEditors()` is available. Do not mutate the old key's value to an object.

Before:

```ts
"pinned-editors": string[];
// Settings load: migrateLegacyPinnedEditors(settings["pinned-editors"])
```

After:

```ts
interface EditorCategory { id: string; name: string; items: string[] }
"editor-categories": EditorCategory[]; // [{ id: "top", name: "", items: [...] }, ...]
// if editor-categories is absent:
const topItems = oldPinned === undefined
    ? [...DEFAULT_PINNED_EDITORS]
    : (migrateLegacyPinnedEditors(oldPinned) ?? []);
settings["editor-categories"] = [{ id: "top", name: "", items: topItems }];
delete settings["pinned-editors"];
```

For preexisting `editor-categories`, normalize to exactly one Top first, preserve user category order and stale item refs, and enforce exclusive membership by retaining the first occurrence in category/item order. Top's stored `name` is ignored and normalized to empty. New category IDs are generated once and remain stable; reject empty names and case-insensitive duplicates. Put category CRUD/order/membership and ref encoding helpers in `src/renderer/ui/sidebar/pinned-items.ts` (retain its path). Remove `pinned-editors` from settings type/default/description after migration support is installed.

Update the settings namespace prose in `src/renderer/scripting/ai-vision/namespaces/settings.ts` to describe `editor-categories`; update `assets/guides/scripting/api/settings.md` with the new JSON shape, Top and Other semantics, migration, and the fact that arbitrary `settings.get`/`set` remains the API. Update `doc/architecture/scripting.md` and `src/renderer/api/settings.ts` description. Keep `src/renderer/api/types/settings.d.ts` and `assets/editor-types/settings.d.ts` generic; they expose arbitrary keys and do not declare settings individually. No dedicated MCP endpoint exists, so document that MCP Object Model `settings.get`/`settings.set` observes the same new key.

### 2. Shared visual layout and category manager

Add `src/renderer/ui/sidebar/EditorCategoryColumnListView.ts` and `.css`. It owns the shared list layout and takes category/group descriptors, rows, and callbacks; `EditorCategoriesView` and `EditorCategoriesPopoverView` provide their own toolbar/filter/footer around this list. Match the SSDA column-flow geometry explicitly: `display:flex; flex-direction:column; flex-wrap:wrap; align-content:flex-start`; fixed-height list with `overflow-x:auto` and hidden vertical overflow; every group is a fixed 236px-wide column item. Groups flow top-to-bottom, then continue in the next horizontal column. Heading is small, bold, uppercase, accent-colored, with a 1px bottom divider and small top margin except the first heading. Rows use approximately `3px 5px` padding, icon plus one-line ellipsized label, and a hover tint. Use Persephone theme tokens only: `color.primary.text` for heading accent, `color.border.default` for divider, `color.background.overlayHover` for row hover, `color.text.default` for labels, `color.text.light` / `color.icon.light` for muted/placeholder content, and `color.background.default` for surfaces. No literal color values.

In `src/renderer/ui/sidebar/EditorCategoriesView.ts` and `.css`, render a toolbar with localized New category action; creating inserts a user category and immediately starts inline rename. User block heading supports inline rename (Enter commits, Escape cancels; empty or case-insensitive duplicate name is rejected), delete action appears on hover, and delete confirms only for nonempty category. Category item rows show a remove × action on hover and open the item on double-click. Empty user blocks show muted “Drag editors here”. Top has no rename/delete/reorder controls. Do not render Other in this panel. Make categories and items draggable as specified in step 4.

### 3. Concrete merged Editors tree

Add `src/renderer/ui/sidebar/EditorsTreeView.ts` and `.css` as an app-owned `TreeView<EditorTreeNode>` composition. Do not wrap `BoardsTreeView`: that view owns its own `TreeView`, so wrapping would prevent inserting the synthetic Built-in root or shared category row adornments. Instead, reuse `BoardTreeNode` and `buildBoardsTree()` from `src/renderer/editors/board/boards-tree-build.ts`, prepend a synthetic Built-in root, and render both node kinds from one Tree. Define `BuiltinEditorNode = { kind: "builtin"; value: string; label: string; item: CreatableItem; disabled?: boolean }` and `EditorTreeNode = { kind: "builtin-root"; value: "builtin-root"; label: string; items: BuiltinEditorNode[] } | BuiltinEditorNode | BoardTreeNode`. The first root is localized “Built-in”; its children follow `getCreatableItems()` registry order. Trusted board folder/board nodes from `buildBoardsTree()` follow it in their existing folder-first/alphabetical order. Keep disabled bundled boards as non-draggable, non-assignable management rows after enabled built-ins so `getBundledBoardContextMenu()` retains Enable; exclude them from category choices, Other, and popover. This management-only tree row is the exception required to preserve the existing Enable action; it is never rendered in a category or quick-list group.

Before, `ToolsHubEditorView.mountBody()` mounts Built-in and Boards as separate views:

```ts
tab === "builtin" ? new BuiltinEditorsListView({})
    : tab === "boards" ? new TrustedBoardsListView({}) : ...;
```

After, the `EditorsTreeView.treeProps()` provider prepends a real synthetic parent and appends the exact board nodes produced by the existing builder:

```ts
const builtins: BuiltinEditorNode[] = getCreatableItems(browserProfiles).map((item) => ({
    kind: "builtin", value: item.id, label: getCreatableItemLabel(item), item,
}));
const boardNodes = buildBoardsTree(trustedRoots, undefined, (root, fallback) =>
    boardDisplayText(root, manifests.get(root), boardMetadataKeys.name,
        manifests.get(root)?.name?.trim() || fallback));
const items: EditorTreeNode[] = [
    { kind: "builtin-root", value: "builtin-root", label: t("shell.editorCategoryBuiltinRoot"), items: builtins },
    ...boardNodes,
];
return { name: "editors-tree", items, getChildren: (node) => node.items, getIconElement, renderTrailing, getContextMenu, onChange };
```

`getDisabledBundledBoardItems()` are appended as disabled management children to Built-in after `getCreatableItems()`; they cannot be dragged or categorized.

Render Built-in rows with the same icon and label as `BuiltinEditorsListView` / `getCreatableItemLabel()`, make enabled rows open via `CreatableItem.create()`, and retain bundled-board Disable/Enable context actions from `getBundledBoardContextMenu()` (`src/renderer/ui/sidebar/tools-editors-registry.ts`). For board nodes preserve `BoardsTreeView` behavior and `TrustedBoardsListView` actions: board glyph/folder icon, open on row activation via `openBoard`, update available context action (`listBoardUpdates` / `runBoardUpdate`), Copy board path, Open board folder, Remove/untrust, and trailing update tag. Pin-button trailing actions become category indication instead: append the current category name as small muted trailing text for members; rows in Other/uncategorized show no category label.

The Tree's exact drag/drop configuration for built-in and eligible board leaves is:

```ts
traitTypeId: TraitTypeId.PinnedEditor,
getDragData: (node: EditorTreeNode) => eligibleRef(node)
    ? ({ kind: "source", ref: refFor(node) } satisfies EditorCategoryDragData)
    : null,
acceptsDrop: false,
getContextMenu: (node) => editorContextMenu(node),
```

`TreeProps` uses `traitTypeId`, `getDragData`, `acceptsDrop`, and `getContextMenu` from `src/renderer/uikit/Tree/types.ts`. The Tree is a source only; `acceptsDrop: false` means its rows are not targets. The named outer Editors-pane surface is the precise drop target for uncategorizing a categorized item; its native `dragenter`/`dragover`/`drop` handlers verify `TraitTypeId.PinnedEditor` and `{ kind: "category-item" | "source", ref }`, then remove membership. Category blocks and item rows are independent native targets. `canTraitDrop` and `onTraitDrop` are deliberately omitted because no Tree row should receive an assignment drop. Tree's row-only `acceptsDrop` behavior is documented in `Tree/types.ts` and implemented in `TreeDndModel.ts`.

### 4. Drag and context-menu assignment

Use the existing `TraitTypeId.PinnedEditor`. Define a JSON-serializable payload union in `src/renderer/ui/sidebar/pinned-items.ts`:

```ts
type EditorCategoryDragData =
  | { kind: "source"; ref: PinnedRef }
  | { kind: "category-item"; categoryId: string; ref: PinnedRef }
  | { kind: "category-block"; categoryId: string };
```

Tree rows emit `source`; category item rows emit `category-item`; category headers emit `category-block`. Category item rows accept `source` or `category-item` and drop into their exact index, causing an exclusive move/reorder. Category blocks accept either item/source payload and append to that category. Category headers accept `category-block` to reorder user categories; Top rejects block drag/drop. The outer Editors pane accepts item/source payload to remove membership and return it to Other; its drop listener verifies the trait type and payload before `preventDefault()`. Other itself is available in the popover only and accepts a drag to remove category membership. No OS file drags are accepted.

Each eligible Tree row context menu adds a localized “Add to category” submenu with each category, “New category…”, and “Remove from category” when assigned. “New category…” creates a category, then assigns that ref and opens its inline rename field. Existing bundled Enable/Disable, update, copy/open folder, and untrust actions remain in the same menu, separated with menu groups. Category item context actions and drag must use the same `moveEditorToCategory`, `moveCategoryItem`, `moveCategory`, and `removeCategoryMembership` helpers.

### 5. Hub and compact sidebar

Change `HubTab` and `VALID_HUB_TABS` in `src/renderer/editors/tools-hub/ToolsHubEditor.ts`; default becomes `editors`. During restore, map old `builtin` and `boards` values to `editors` before validating, preserving `search`, `tools`, and `site-extensions`.

Before:

```ts
type HubTab = "builtin" | "boards" | "search" | "tools" | "site-extensions";
const VALID_HUB_TABS = ["builtin", "boards", "search", "tools", "site-extensions"];
```

After:

```ts
type HubTab = "editors" | "search" | "tools" | "site-extensions";
const VALID_HUB_TABS = ["editors", "search", "tools", "site-extensions"];
const VALID_HUB_TABS: readonly HubTab[] = ["editors", "search", "tools", "site-extensions"];
function restoreHubTab(value: unknown): HubTab {
  if (value === "builtin" || value === "boards") return "editors";
  return VALID_HUB_TABS.includes(value as HubTab) ? value as HubTab : "editors";
}
async restore(): Promise<void> {
  await super.restore();
  this.state.update((s) => {
    s.tab = restoreHubTab(s.tab);
    s.title = untranslated("Tools & Editors");
  });
}
```

In `src/renderer/editors/tools-hub/ToolsHubView.ts`, remove `PinnedRailView` construction, mounting, and update subscriptions from all tab branches. For `tab === "editors"`, compose `EditorCategoriesView`, vertical `SplitterView` (`value: 50`, `min: 30`, `max: 70`), and `EditorsTreeView` in a horizontal row. Keep splitter percentage view-local; `ToolsHubEditorState` stores only `tab`. Other tabs keep their current content and get no rail.

In `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts`, tabs become Editors and Tools. Editors mounts the same `EditorsTreeView`; remove `PinnedRailView`, its drag session listener/unpin surface, and the old Built-in/Boards split. Map compact Editors to hub `editors` in `panelTabToHubTab()`. Category CRUD stays in the full hub; `+` popover remains the quick editor list. Delete `PinnedRailView.ts`, `BuiltinEditorsListView.ts`, and `TrustedBoardsListView.ts` after moving their still-needed behavior into `EditorsTreeView`; preserve shared registry and `BoardsTreeView` modules.

### 6. New-tab split button popover

Extend `SplitButtonProps` in `src/renderer/uikit/SplitButton/SplitButtonView.ts` additively. The default `items` path and caret `openMenu()` remain unchanged for Git pull and Explorer board consumers. If `onOpenMenu` is supplied, caret click calls it with `this.caretView.root` as anchor and does not open the default Menu. Primary `onClick` is untouched.

Before:

```ts
interface SplitButtonProps { onClick: () => void; items: MenuItem[]; }
private onCaretClick = () => openMenu(this.caretView.root, this.menuOptions(this.props));
```

After:

```ts
interface SplitButtonProps {
  onClick: () => void;
  items: MenuItem[]; // retain existing callers
  onOpenMenu?: (anchor: HTMLElement) => void; // caller owns overlay lifecycle
}
private onCaretClick = () => this.props.onOpenMenu
  ? this.props.onOpenMenu(this.caretView.root)
  : openMenu(this.caretView.root, this.menuOptions(this.props));
```

`PageTabsView` supplies `onOpenMenu` and mounts `EditorCategoriesPopoverView` with `PopoverView` anchored to that caret. Popover max width is `min(720px, calc(100vw - 16px))`; shared list height is fixed at `min(60vh, 520px)` with horizontal scrolling. Content order: Top, user categories with at least one visible eligible item, Other, then footer. Top uses localized label; Other is derived from all eligible refs missing from any category and preserves merged Editors-tree order. Stale refs and disabled bundled boards do not render. Category headings and rows use the shared column-flow layout above.

The popover opens bottom-start, aligned to the caret's left edge. Its themed filter input is to the left of “Show all…” and autofocuses; it filters matches across all groups without changing stored data. Enter opens the first visible match, Escape closes, and ArrowUp/ArrowDown moves an active row across group boundaries with focus/active styling. Clicking an item opens it using the existing creatable or trusted-board path and closes the popover. The popover can be resized from its bottom-right corner; its size persists in the hidden `editor-categories-popover-size` setting as `{ width, height }` pixels or `null`. The popover and Categories panel scroll overflowing columns horizontally with the mouse wheel. Dragging a category header onto another header moves it before the target. Footer “Show all…” opens the full Tools & Editors hub with `{ tab: "editors" }`. `PopoverView` content adopts its supplied host and closes on outside pointer/Escape.

### 7. Localization, hooks, guides, and architecture docs

Add the following source keys to `src/shared/i18n/en/shell.ts` (area `shell`). Use `t("shell.<key>")` at app call sites. The new English keys are intentionally not copied into the 17 language packs; untranslated keys fall back to English. Existing common keys such as `common.remove`, `shell.enable`, `shell.disable`, `shell.update`, and `shell.copyBoardPath` remain reused.

| Key | English text | Area/use |
|---|---|---|
| `editorCategoryTop` | Top | shell; fixed category heading |
| `editorCategoryEditorsTab` | Editors | shell; merged hub/sidebar tab |
| `editorCategoryBuiltinRoot` | Built-in | shell; synthetic first tree root |
| `editorCategoryOther` | Other | shell; derived group |
| `editorCategories` | Categories | shell; panel title |
| `editorCategoryNew` | New category | shell; toolbar action |
| `editorCategoryRename` | Rename category | shell; header action |
| `editorCategoryDelete` | Delete category | shell; header action |
| `editorCategoryNamePlaceholder` | Category name | shell; inline input placeholder |
| `editorCategoryDeleteConfirm` | Delete “{name}” and move its editors to Other? | shell; nonempty delete dialog |
| `editorCategoryNameRequired` | Enter a category name. | shell; validation |
| `editorCategoryNameDuplicate` | A category with this name already exists. | shell; validation |
| `editorCategoryDragHere` | Drag editors here | shell; empty block placeholder |
| `editorCategoryRemoveItem` | Remove from category | shell; row action/context menu |
| `editorCategoryAddTo` | Add to category | shell; context submenu |
| `editorCategoryNewAndAssign` | New category… | shell; context submenu action |
| `editorCategoryFilterPlaceholder` | Filter editors… | shell; popover filter |
| `editorCategoryShowAll` | Show all… | shell; popover footer |
| `editorCategoryPopoverLabel` | New editor | shell; popover accessible label |

Add `data-name` to app-owned addressing points per `doc/architecture/ui-element-contract.md` (debug handles, additive, not styling selectors): popover root `editor-categories-popover`, filter `editor-categories-filter`, shared flow list `editor-category-column-list`, hub manager `editor-categories-panel`, toolbar button `editor-category-new`, each block `editor-category-block` with `data-category-id`, block header `editor-category-header`, repeated row `editor-category-item` with `data-item-ref`, remove action `editor-category-remove`, inline name input `editor-category-name`, popover item `editor-category-popover-item` with `data-item-ref`, footer `editor-category-show-all`, Editors tree `editors-tree`, and split control `editor-categories-splitter`. Do not rename the existing contractual `[data-name="page-tabs-add"]` hook.

Update present-tense pin instructions in `assets/guides/getting-started.md`, `assets/guides/tabs-and-navigation.md`, `assets/guides/editors/index.md`, `assets/guides/editors/browser.md`, and `assets/guides/screens/mcp-inspector.md`; add current release entry to `assets/guides/whats-new.md` while leaving historical release notes intact. Update `doc/architecture/editors.md`, `doc/architecture/overview.md`, `doc/architecture/folder-structure.md`, and `doc/architecture/key-files.md` to describe the new key, merged tree, and category views. Keep `src/renderer/api/types/settings.d.ts` and `assets/editor-types/settings.d.ts` generic; no setting-specific declarations exist to update.

## Acceptance Criteria

- Settings migrate losslessly from `pinned-editors` through the legacy ID mapping or current defaults into Top, persist `editor-categories`, and remove the old key. Old array readers are not silently given an object.
- Top is fixed first and immutable; user categories can be created, inline-renamed with validation, reordered, and deleted with the stated nonempty confirmation and uncategorize behavior.
- Exclusive category membership uses the full current pinnable surface; stale refs remain stored and hidden. Disabled bundled boards cannot appear in category/popover/Other surfaces; every trusted board can.
- Both category surfaces use the specified 236px column-flow geometry, theme tokens, horizontal overflow, and dense rows. The popover filter, keyboard behavior, click-to-open, resizable persistent size, horizontal wheel scrolling, and Show all action work as specified.
- SplitButton main action remains unchanged; optional `onOpenMenu(anchor)` affects only `PageTabsView`, preserving Git pull and Explorer menus.
- Hub tab restores old `builtin`/`boards` as `editors`, has no Pinned rail on any tab, and the Editors pane shows the fully expanded tree on the left and a Categories pane on the right, with pixel sizing clamped to 30–70% width. Its Editors-only filter and row chips work as specified. Sidebar has one Editors tab and no horizontal rail.
- Editors tree preserves Built-in open and Enable/Disable behavior and Registered boards open/update/path/folder/untrust behavior; row category labels reflect stored membership.
- Tree/category drag payload, exact targets, context menu assignment, category/item ordering, and uncategorize-to-Other behavior follow steps 3–4.
- All listed strings are in the English catalog; the 17 language packs intentionally rely on English fallback. Current user guides, scripting API guidance, architecture pages, and `data-name` hooks are updated.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1748-editor-categories/README.md` | This implementation-ready investigation |
| `doc/active-work.md` | Standalone Active task link |
| `src/renderer/api/settings.ts` | New key type/default/description and migration; retire old key |
| `src/renderer/ui/sidebar/pinned-items.ts` | Category normalization, migration helpers, ordering, exclusive membership, drag payload union |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts`, `assets/guides/scripting/api/settings.md`, `doc/architecture/scripting.md` | New settings API name/shape and MCP/Object Model guidance |
| `src/renderer/ui/sidebar/EditorCategoryColumnListView.ts`, `.css` | Shared column-flow list view and styling |
| `src/renderer/ui/sidebar/EditorCategoriesView.ts`, `.css` | Hub category manager |
| `src/renderer/ui/sidebar/EditorsTreeView.ts`, `.css` | Synthetic Built-in root plus existing board tree nodes and preserved actions |
| `src/renderer/editors/tools-hub/ToolsHubEditor.ts`, `ToolsHubView.ts` | Editors tab identity/restore migration, two-pane layout, remove all Pinned rails |
| `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` | Merge Built-in/Boards, use Editors tree, remove rail |
| `src/renderer/ui/tabs/PageTabsView.ts`, `EditorCategoriesPopoverView.ts`, `EditorCategoriesPopoverView.css` | Anchored category popover and item opening |
| `src/renderer/uikit/SplitButton/SplitButtonView.ts` | Optional caller-owned caret menu callback, legacy Menu behavior retained |
| `src/renderer/ui/sidebar/PinnedRailView.ts`, `BuiltinEditorsListView.ts`, `TrustedBoardsListView.ts` | Retire after moving required actions into replacement views |
| `src/shared/i18n/en/shell.ts` | New English source keys; language packs use fallback |
| `assets/guides/getting-started.md`, `tabs-and-navigation.md`, `editors/index.md`, `editors/browser.md`, `screens/mcp-inspector.md`, `whats-new.md` | Current category instructions and release entry; retain historical notes |
| `doc/architecture/editors.md`, `overview.md`, `folder-structure.md`, `key-files.md` | Updated settings/view architecture and file index |

### Verified files expected to need no changes

- `src/renderer/uikit/Popover/PopoverView.ts` and `src/renderer/uikit/Popover/PopoverModel.ts`: existing anchored native `contentView`, outside-pointer dismissal, Escape dismissal, and placement are sufficient.
- `src/renderer/uikit/Tree/TreeDndModel.ts` and `src/renderer/uikit/Tree/types.ts`: existing trait drag API already exposes the required row callbacks; app-owned category blocks and pane wrapper provide non-Tree targets because Tree drops are row-only.
- `src/renderer/uikit/Splitter/SplitterView.ts`: existing resizable divider supports the desired two-pane layout.
- `src/renderer/uikit/CategoryList/CategoryListView.ts` and `CategoryList.css`: keep as-is; this is a browse/selection component rather than an explicit CRUD block manager.
- `src/renderer/core/traits/TraitRegistry.ts` and `src/renderer/core/traits/dnd.ts`: retain the registered `TraitTypeId.PinnedEditor`; only its JSON payload data union changes in the app-owned helper.
- `src/renderer/api/types/settings.d.ts` and `assets/editor-types/settings.d.ts`: keep generic settings get/set signatures; the new setting is documented rather than adding setting-specific API types.
- Git pull and Explorer board `SplitButtonView` callers: no caller changes because the new callback is optional and omitted there.
