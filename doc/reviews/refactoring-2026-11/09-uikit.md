> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 09-uikit — UIKit library and Persephone-coupled components — refactoring review

## Summary

The overall health is mixed. The UIKit library has one consistent pattern: `VanillaView` with an optional `TComponentModel` plus driver, static CSS, `KeyedList` and `SubtreeSwap`. Simple primitives such as `SwitchView`, `SpacerView` and `ButtonView` are clean, and the av-grid boundary holds: nothing outside `uikit/DataGrid` imports `av-grid`. The weak spots are at a different level. The largest components carry duplicated infrastructure and features nobody uses, and the provider-tree code in `components/` has grown into large, mixed-responsibility models. The layering is nearly clean. There is one real UIKit→editors runtime edge and an undocumented `components/pipe-status` folder that imports `editors/base`.

The three biggest problems:
1. **`TreeProviderViewModel` (1,306 lines) is a god class.** It handles provider loading, incremental FS-watch patching (including file-system and git specifics), expansion bookkeeping, search, selection, keyboard commands, context menus, CRUD, drag-drop and persistence. The most recent Codex change (US-1758) added the least-encapsulated part.
2. **Expansion and lazy loading are owned twice.** `Tree` keeps expansion as uncontrolled internal state and ships a lazy-load API (`loadChildren`, `getAncestorValues`, a per-row loading spinner) that only the Storybook demo uses. Its one real lazy consumer re-implements lazy loading and keeps its own copy of expansion in parallel. It remounts the whole `Tree` to reset expansion.
3. **The two provider-tree models duplicate a whole "provider item controller".** These are `TreeProviderViewModel` and `CategoryViewModel`: watch subscription, CRUD context, menu dispatch, plural targets, drag items, the context-menu layering and key guards are all written twice. Provider capabilities are sniffed with `as any` or `type === "file"` instead of being declared.

Secondary themes:
- Pooled virtualized-row hosting is copy-pasted across `ListBoxView` and `TreeView`, and four more views outside UIKit repeat it.
- Repaint change-detection is implemented three overlapping ways, and they have already drifted apart.
- The combobox family carries three copies of the filter function and five keyboard-navigation switches.
- A layer of dead React-era barrels, version counters and props is still in place.

## Findings

### UIK-1: `TreeProviderViewModel` mixes eight jobs; the incremental-watch path leaks file-system and git knowledge into a generic tree model
- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/components/tree-provider/TreeProviderViewModel.ts:147-1170` (whole class); `:263-275` (watch subscription); `:286-355` (`queueWatchRefresh`); `:399-495` (`buildTree`); `:499-576` (two more lazy-load paths); `:601-621` (CRUD and menu glue); `:693-804` (search); `:884-944` (keyboard commands); `:948-1041` (menus); `:1079-1169` (drag-drop); `:1176-1306` (pure tree utilities)
- **Problem:** One `TComponentModel` subclass owns all of the following:
  - Provider listing.
  - Three near-identical "list → check generation → `updateNodeChildren` → recompute `displayTree` → `state.update`" sequences: `buildTree` `:455-466`, `loadChildrenIfNeeded` `:512-534` and `loadChildrenForPaths` `:548-575`, plus a fourth inside `queueWatchRefresh` `:330-350`.
  - Expansion hints and their merging (`initialExpandMap`, `savedExpandMap`, `expandedResolver`). The same merge is written out twice: `:412-421` and `:734-746`.
  - Search filtering (`computeDisplayTree`, the deep/shallow switch at length ≥ 3).
  - Selection plus pruning to visible rows.
  - Keyboard commands for Delete, F2 and Ctrl+C/X/V.
  - Three context-menu builders and event-channel layering.
  - CRUD wrappers.
  - Drag-out and drop-target resolution, plus state persistence.

  The US-1758 incremental refresh (`03b31e0f`) is a 70-line async closure with these problems:
  - It has its own path `normalize`, which duplicates `normalizeHref` (`href-utils.ts:13`) with an added `fpResolve`.
  - It has its own recursive `find`, which duplicates `findNode` at `:1189`.
  - Magic numbers (`batch.changes.length > 100`).
  - Git-specific marker logic (`key.endsWith("/.git/head")`, `:325`).
  - A locally declared `IncrementalTreeProvider` cast (`:50-52`, `:294`, `:335`) inside a model that is supposed to work for any `ITreeProvider`: archive, link, Mneme or script library.

  It also violates coding-style rules: `err.message ||` at `:492` and `:1165` instead of `errMessage()`. A no-op `toNode` (`items: item.isDirectory ? undefined : undefined`, `:1184`) and an inline `import("…")` type for a symbol already imported (`:82`) are further signs of accretion.
- **Refactor:** Split it into collaborators the model composes, keeping the public API (`revealItem`, `expandPath`, `collapsePath`, `getState`) on a thin facade:
  1. `ProviderTreeStore` (new file, `components/tree-provider/provider-tree-store.ts`) owns the immutable node tree.
     - It owns the generation token and one `loadChildren(hrefs[]): Promise<void>` that every path uses: build, lazy expand, reveal, restore and watch.
     - It exposes `tree`, `findNode`, `findParent` and `updateChildren`, and moves the pure utilities `:1176-1225` into it.
  2. Move "which directories need re-listing for this watch batch" behind the provider.
     - `FileTreeProvider` already owns `watch` and `listIncremental`. Give it `watchDirectories(cb: (dirs: string[] | "all") => void)`, or have its `watch` callback emit an already-classified `{ relist: string[] } | { rebuild: true }`.
     - The `.git/HEAD` rule, path normalization and the 100-change threshold then live next to the file system code. `ProviderTreeStore` just re-lists the hrefs it is given.
  3. Make `TreeSearchFilter` a pure module: `filterDirectoriesOnly`, `filterTreeDeep`, `filterTreeShallow`, `computeDisplayTree(tree, query, showLinks, expanded)`. It shares the word-match predicate with `CategoryViewModel.filterItems` (`CategoryViewModel.ts:782`).
  4. Move expansion ownership out entirely (see UIK-2).
  5. Move the item commands into the shared controller from UIK-3: context menu, keyboard, CRUD, drag items and drop targets.
  6. What remains in `TreeProviderViewModel`, under about 300 lines: prop adoption (`setProps`), selection state, wiring the store to state, and persistence.
- **Risk / notes:** The watch and expansion paths carry hard-won ordering fixes, documented in comments at `:403-411`, `:442-453` and `:726-733`. Move them verbatim, with the comments. Do this after UIK-2 settles who owns expansion, otherwise the store must keep reading `treeModel.getExpandedMap()`. It is coupled with UIK-3: do UIK-3 first or together with this.

### UIK-2: Expansion and lazy loading are owned twice; `Tree`'s own lazy-load and custom-render paths are dead in production
- **Priority:** P1
- **Effort:** M
- **Where:** `src/renderer/uikit/Tree/TreeModel.ts:18-50` (`TreeState.expanded`, `loading`, `revision`), `:555-612` (`needsLazyLoad`, `runLoadAndExpand`), `:795-847` (`revealItem` slow path via `getAncestorValues`); `src/renderer/uikit/Tree/types.ts:268-297` (`loadChildren`, `onLoadError`, `getAncestorValues`); `src/renderer/uikit/Tree/TreeView.ts:403-434`, `:489-505` (`renderItem` "custom" kind); `src/renderer/components/tree-provider/TreeProviderViewModel.ts:135-141` (`TreeController` back-reference), `:151-153`, `:385-387`, `:640-661`, `:695-759`; `src/renderer/components/tree-provider/TreeProviderViewImpl.ts:156-186` (remount on `searchKey`)
- **Problem:**
  - **Expansion is uncontrolled.** `Tree` keeps expansion as internal state and accepts only `defaultExpandedValues` hints, which contradicts Rule 2 (controlled components) in `uikit/CLAUDE.md`.
    - Its main consumer must persist expansion, restore it, save it before a deep search, restore it after the search, and keep it across rebuilds. To do that, `TreeProviderViewModel` holds a back-reference to the child's model (`setTreeModel`, a `TreeController` interface) and keeps two hint maps.
    - It has to re-derive "effective expansion" by merging `getExpandedMap()` with its hints. Comments document a shipped bug from getting this wrong (US-1039, `:726-733`).
    - To *reset* expansion it bumps `searchKey`, which makes `TreeProviderViewImpl` dispose and recreate the whole `TreeView` (`:156-159`).
  - **Lazy loading is duplicated.** `Tree` implements lazy loading itself: `loadChildren` with per-row `loading` state and a spinner in `TreeItemView`, `getAncestorValues` for revealing unloaded rows, and `onLoadError`. No production consumer passes any of these: grep finds them only in `Tree.story.ts:239-259`. The one real lazy tree, the provider tree, implements its own lazy loading through `onExpandChange` → `loadChildrenIfNeeded`. Its reveal is `loadChildrenForPaths` + `treeModel.revealItem`.
  - **Unused custom renderers.** `renderItem` has no consumer on `Tree` or `ListBox`; `MultiListBoxView.ts:81` says so for ListBox. The "custom" cell kind, `renderContext` and its signature slots exist only for stories.
  - **Dead state.** `TreeState.revision` is written (`TreeModel.ts:610`) but never read. The documentation in `types.ts:283-285` that it "forces the rows derivation to re-walk" is false: `deriveRows` reads only `expanded`.
- **Refactor:**
  1. Give `Tree` an optional controlled expansion: `expanded?: ReadonlySet<string|number> | Record<…, boolean>` plus `onExpandedChange(next)`. When it is supplied, `TreeModel` derives rows from it and writes nothing to `state.expanded`, and the `defaultExpanded*` hints stay for uncontrolled consumers. `TreeProviderViewModel` (or its UIK-1 store) then owns a single expansion map. This removes the following:
     - `initialExpandMap`, `savedExpandMap` and `expandedResolver`.
     - The `TreeController` back-reference.
     - `searchKey` and the remount.
     - The duplicated merge code.

     A deep search becomes "swap the controlled map; restore it on clear".
  2. Decide on one lazy-load owner.
     - **Option A:** delete `loadChildren`, `onLoadError`, `getAncestorValues`, `TreeState.loading`, `revision`, `runLoadAndExpand` and the slow `revealItem` path. That is about 150 lines of `TreeModel`, plus the loading-chevron branch in `TreeItemView` and the lazy demo.
     - **Option B:** make the provider tree use `loadChildren`, with the provider store resolving the promise.

     Option A is simpler, because the provider store must keep its own immutable node tree anyway.
  3. Remove the "custom" `renderItem` cell kind from `TreeView` and `ListBoxView` until a consumer needs it, along with the matching signature slots in `TreeModel.repaintSignature`/`setProps` and `ListBoxModel`.
- **Risk / notes:** Seven `TreeView` consumers exist. Only the provider tree reads `getExpandedMap`, and `GitRefsView` passes `defaultExpandedValues` (`editors/git-tree/GitRefsView.ts:182`), so a controlled mode is additive. Storybook's Tree demo loses its lazy toggle under option A. This is a prerequisite for the clean form of UIK-1.

### UIK-3: `TreeProviderViewModel` and `CategoryViewModel` duplicate one "provider item controller"; provider capabilities are sniffed, not declared
- **Priority:** P1
- **Effort:** M
- **Where:**
  - Watch subscription: `TreeProviderViewModel.ts:263-275` vs `CategoryViewModel.ts:229-244`, both with `provider as any` and an eslint disable.
  - `itemCrudContext` / `itemMenuActions`: `TreeProviderViewModel.ts:601-621` vs `CategoryViewModel.ts:719-735`.
  - `getItemListPath`: `TreeProviderViewModel.ts:585-599` vs `CategoryViewModel.ts:715-717`.
  - `multiTargets`: `:1007-1014` vs `:682-689`.
  - `dragItemsFor`: `:1088-1098` vs `:436-442`.
  - `deleteItemsAction`: `:1065-1077` vs `:764-775`.
  - `onItemContextMenu` layering: `:948-983` vs `:627-674`.
  - `onBackgroundContextMenu`: `:985-998` vs `:696-708`.
  - Editable-target key guard: `:886-889` vs `:385-386`.
  - OS drag start: `TreeProviderViewImpl.ts:447-459` vs `CategoryViewModel.ts:453-462`.
  - Capability sniffing: `os-clipboard.ts:19-21` and `plural-actions.ts:22-24` (identical `provider.type === "file"` bodies under two names); `TreeProviderViewImpl.ts:334` (`dragTraitTypeId as TraitTypeId`); `TreeProviderViewModel.ts:50-52`, `:294`.
- **Problem:**
  - **Duplicated glue.** The shared action *modules* (`item-crud-actions.ts`, `item-menus.ts`, `plural-actions.ts`, `tree-drop-actions.ts`, `drop-dispatch.ts`) are a good extraction, but the *glue* that adapts them to a view was written twice and is drifting.
    - The tree's item context menu runs the event-channel layer and the parent callback even for a multi-selection. The folder page skips both layers for a multi-selection (`CategoryViewModel.ts:643-656`) and has no parent callback at all.
    - The folder page re-implements the tree's drop-hover protocol: a `DragEnterCounter`, `acceptsDrag`, `dropEffect` and `preventDefault` (`:480-556`). Its own comment says "Mirrors `TreeModel.acceptsDrag`".
  - **Inconsistent href identity.** The two models compare hrefs four ways:
    - `sameHref`: case-insensitive.
    - `selectedValues.includes(href)`: case-sensitive (`TreeProviderViewModel.ts:1011`, `:1093`).
    - `selectedSet` lowercased in the view (`TreeProviderViewImpl.ts:345`, `:367`).
    - `normalize` with separator folding and `fpResolve` in the watch path.

    A selection adopted with different casing can paint as selected yet be excluded from plural menus and drags.
  - **Sniffed capabilities.** `watch` and `listIncremental` are real provider capabilities that are absent from `ITreeProvider` (`api/types/io.tree.d.ts`), so every consumer duck-types them. "Is a local file tree" is spelled `type === "file"` in two differently named helpers.
  - **Error stringification.** `CategoryViewModel.ts:271-276` uses `catch (err: any)` with `err.message ||`, violating the `errMessage` rule.
- **Refactor:**
  1. Introduce `ProviderItemController` (`components/tree-provider/provider-item-controller.ts`), constructed by each model with `{ provider, getItemPath, refresh, getSelection(): ITreeProviderItem[], multiSelect, onFolderOpen? }`. It owns:
     - `crudContext` and `menuActions`.
     - `contextMenuFor(item, event)`, with a single, documented rule for whether layer 2 and the parent callback run for plural selections.
     - `backgroundMenu(event, directory)`.
     - `pluralTargets(item)` and `dragItemsFor(item)`.
     - `startOsDrag(items, event)`.
     - `handleKey(event, primary)` for Delete, F2 and clipboard.
     - `deleteMany(items)`.

     Both models delegate to it and keep only how they resolve a selection: the node tree versus the flat `filteredItems`.
  2. Add a renderer-internal capability contract next to the providers. Keep it out of the public `io.tree.d.ts` script typing; for example `content/tree-providers/tree-provider-capabilities.ts`:
     - `interface WatchableTreeProvider { watch(cb): () => void }`.
     - `interface IncrementalTreeProvider { listIncremental(dir): Promise<…> }`.
     - Type guards `isWatchable(p)` and `isIncremental(p)`.
     - A single `isLocalFileProvider(p)` that replaces `supportsOsClipboard` and `supportsMultiSelect`.

     Delete the `as any` and `as TraitTypeId` casts.
  3. Use one href-identity helper (`hrefKey(href)` in `href-utils.ts`) for selection sets, membership checks and watch matching.
  4. Extract the drop-hover protocol into `uikit/shared/drop-target-tracker.ts`: a counter, the hovered key, an `accepts(dataTransfer)` predicate and the `dropEffect` choice. `TreeDndModel` and `CategoryViewModel` both use it.
- **Risk / notes:** The behaviour of the multi-selection context menu differs today, so pick one deliberately and record it in the task. The OS-drag override lives in the view for the tree and in the model for the folder page; settle it in the controller. Land this before UIK-1, which then becomes mostly deletion.

### UIK-4: Pooled virtual-row hosting is copy-pasted across `ListBoxView`, `TreeView` and four views outside UIKit
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/uikit/ListBox/ListBoxView.ts:24-51`, `:257-351`, `:382-443`, `:476-531`.
  - `src/renderer/uikit/Tree/TreeView.ts:25-41`, `:246-354`, `:378-437`, `:515-606`.
  - The same pattern (`p.previous ?? p.recycle?.()`, a `WeakMap<HTMLElement, record>`, listeners once per wrapper, a `rowViews` set) in `components/file-search/FileSearchView.ts`, `editors/link-editor/LinksListView.ts`, `editors/link-editor/LinksTilesView.ts` and `editors/log-view/LogBodyView.ts`.
- **Problem:** `ListBoxView` and `TreeView` are about 70% the same code, line for line:
  - The `CellRecord` type and its comment.
  - The three-state arm machine (`applyArm`, `enterRealArm`, `leaveRealArm`, `fillMessage`). Both copies have the identical hard-coded `"loading…"` text, which bypasses `uikitText("loading")` (`ListBoxView.ts:346`, `TreeView.ts:349`).
  - The `renderCell` skeleton with kind switching and `releaseCell`.
  - The base four cell listeners, `activeRecord`, `syncActiveScroll`, and the `cssLength`, `setOrRemove` and `toggle` helpers.

  The safety rules this code must obey get a long section of `uikit/CLAUDE.md` (Rule 9, "Native slots inside a virtualized row"):
  - Pooled wrappers keep their listeners.
  - No slot cleanup on eviction.
  - `keepCellsAttached`.
  - The icon-node host check.

  That section records repeated incidents ("this has occurred four times"). Every new copy must re-learn the rules. The copies have started to diverge: `ListBoxView` has an orphaned JSDoc for an `inert` field that no longer exists (`:99-102`) and an orphaned `growToHeight` comment inside `gridProps` (`:363-365`).
- **Refactor:** Add a composition helper, not a base view, to respect "extend `VanillaView` directly": `uikit/shared/pooled-row-host.ts`.
  - It takes an owner `VanillaView` (for `listen` and `own`), a host element, a `RowAdapter<K>` and grid options. The adapter is `{ rowCount(); kindFor(row): K; create(kind,row): VanillaView; update(view,row); onRowEvent(type,index,event) }`.
  - It owns the `RenderGrid` lifecycle, the cell-record `WeakMap`, the `rowViews` set, kind switching, once-per-wrapper listeners and `syncActiveScroll(index, afterPaint)`.
  - It exposes `repaint(info)` and `gridModel`.
  - A sibling `ListShellArms` covers loading, empty and real, with a spinner and `uikitText` defaults.

  `ListBoxView` and `TreeView` then keep only root-attribute writing and row-prop building. Migrate `FileSearchView`, `LinksListView`, `LinksTilesView` and `LogBodyView` afterwards, as separate tasks in their owners' areas. Move the matching Rule 9 prose in `uikit/CLAUDE.md` into the helper's header.
- **Risk / notes:** This is the hottest rendering path, and the pooled-cell rules are subtle. Migrate `ListBoxView` first and exercise Select, Autocomplete and MultiListBox, then `TreeView`. It is independent of UIK-2, but simpler after the "custom" kind is removed.

### UIK-5: Repaint change-detection is implemented three overlapping ways and has already drifted
- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/uikit/Tree/TreeModel.ts:190-276` (18 `applied*` fields + `setProps` classification), `:900-946` (`repaintSignature` + `deriveRepaintChange`); `src/renderer/uikit/ListBox/ListBoxModel.ts:15-27`, `:47-91`, `:375-410` (11 `live*` fields, pending flags, signature, plus targeted setters `:93-138`); `src/renderer/uikit/Tree/TreeView.ts:173-195`; `src/renderer/uikit/ListBox/ListBoxView.ts:221-239`; `src/renderer/components/tree-provider/TreeProviderViewImpl.ts:321-331`
- **Problem:** Answering "which rows must repaint after a props pump" takes three mechanisms:
  1. The model's `setProps` compares every prop against a stored previous copy and raises `pendingGlobalRepaint`/`pendingRowRepaint`. The stored copies are named `applied*` in Tree and `live*` in ListBox for the same concept.
  2. The model publishes a `repaintSignature()` array.
  3. The view runs a `DepsGate` over that array, then asks the model's `deriveRepaintChange` to combine the gate result with the pending flags.

  The lists are maintained by hand and already disagree:
  - `getName` is in Tree's signature (`:910`) but not in its `globalChanged` set (`:233-245`). Changing it alone moves the gate but yields `{ rows: [] }`, so nothing repaints.
  - `getHasChildren` is in `rowsChanged` but not the signature.
  - `getIconElement`, `getHideChevron`, `renderTrailing` and `trailingElement` are read by every cell (`TreeView.ts:458-474`) but appear in neither list.

  At the same time, the main consumer passes fresh arrows for `getHasChildren`, `getHideChevron` and `renderTrailing` from `treeProps()` (`TreeProviderViewImpl.ts:321-331`). That builder runs on every hover (`:397-404`), so each hover re-derives every row. It does so in the very file `doc/standards/model-view-pattern.md:403` cites as the reference example of stable callback fields.

  `ListBoxModel` keeps a `TComponentState` whose only field is documented as "Unused. Kept only so the model has a state object to own" (`:15-27`). It is a model that is not a state model at all.
- **Refactor:** Replace the three layers with one declarative tracker: `uikit/shared/repaint-tracker.ts`.
  - A component declares `{ rows: [...keys], global: [...keys], local: [...keys] }` once.
  - `tracker.diff(prevProps, nextProps)` returns `RerenderInfo | undefined`.
  - Delete the `applied*`/`live*` mirrors, the pending flags and the per-view `DepsGate` wiring for these two components. Keep `DepsGate` for simple views where it is the whole story.

  Then:
  - Make `ListBoxModel` a plain class, not a `TComponentModel` with fake state.
  - Pick one input channel for ListBox, props or targeted setters (`setItems`, `setSelection`, `setActiveIndex`…), not both.
  - Fix `TreeProviderViewImpl.treeProps()` to pass stored fields, and update the doc anchor.
- **Risk / notes:** Rule 9 in `uikit/CLAUDE.md` ("Prop-change detection in a vanilla-driven model", "five rules, each of which has already bitten") becomes much shorter. Pair this with UIK-4 so the tracker and the pooled host land together.

### UIK-6: The combobox and list family duplicates trait resolution, filtering and keyboard navigation, with diverging semantics
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `runAccessor`: `ListBoxModel.ts:33`, `SelectModel.ts:101`, `TreeModel.ts:60`.
  - `resolveSingleValue`: `ListBoxModel.ts:192`, `SelectModel.ts:252`, and `TreeModel.ts:170` as `resolveSelectionValue`.
  - Label filter: `SelectModel.ts:107` and `AutocompleteModel.ts:98` (`defaultMatch`), `MultiListBoxModel.ts:51` (`matches`).
  - Filtered parallel arrays: `SelectModel.ts:270-291`, `MultiListBoxModel.ts:101-112`, and Autocomplete.
  - Keyboard navigation: `ListBoxModel.ts:278`, `SelectModel.ts:492-566`, `AutocompleteModel.ts:308-393`, `PathInputModel.ts:221-280`, `MultiSelectModel.ts:211`, `Tree/TreeKeyboardHandler.ts:58`, `RadioGroupView.ts:197`, `SegmentedControlView.ts:135`.
  - `openInto`/`closeInto` and `popoverResized` in Select, Autocomplete and MultiSelect.
- **Problem:**
  - **Copies.** `defaultMatch` exists as three character-identical copies. `runAccessor` and single-value resolution exist as three copies, even though `core/traits` already exports `resolveTraited` for arrays.
  - **Diverging keyboard semantics.** Select and Autocomplete each hand-write the same ArrowDown/PageDown (step 9), ArrowUp/PageUp, Home, End, Enter and Escape switch, and they already differ.
    - ArrowUp with no active row starts at 0 in Select (`:525`) but at `length` in Autocomplete.
    - Opening on ArrowUp seeds the last row in Autocomplete but the selected row in Select.
    - PathInput wraps around (`PathInputModel.ts:249-260`), while the others clamp.

    Users get different keyboard behaviour from controls that look the same.
- **Refactor:**
  1. Add `resolveTraitedOne<R>(value, key)` to `core/traits/traits.ts` next to `resolveTraited`, and delete the three `runAccessor` and three single-value copies.
  2. Add `uikit/shared/list-filter.ts`: `matchLabel(item, query, mode)` and `filterParallel(items, sources, predicate)`, used by Select, Autocomplete, MultiListBox and, through UIK-1, the tree search.
  3. Add `uikit/shared/list-navigation.ts`: a pure function `nextActiveIndex(key, current, count, { wrap, page }) => number | undefined`. Each model keeps only its own Enter/Escape semantics. Choose clamp versus wrap explicitly per component in its props, instead of by accident.
  4. Optionally extract the shared popover open/close/resize state used by Select, Autocomplete and MultiSelect into a small `ComboboxPopoverState` helper with `openInto`, `closeInto` and `resized`.
- **Risk / notes:** The behaviour changes in step 3 are user-visible, so decide them in the task document. Steps 1 and 2 are pure refactors.

### UIK-7: UIKit is not standalone: a runtime edge into `editors/` (with a cycle), stories bound to the Storybook editor, and app-wide singletons
- **Priority:** P2
- **Effort:** S
- **Where:**
  - Runtime edge and cycle: `src/renderer/uikit/ImageViewport/ImageViewportView.ts:3` → `editors/shared/image-export.ts`, which imports `ipc/renderer/api`, `api/fs`, `api/ui` and i18n, and imports back `uikit/ImageViewport/image-raster` at `image-export.ts:8`.
  - Stories: 42 `uikit/*/*.story.ts` files import `editors/storybook/storyTypes`. `DataGrid.story.ts:10` imports `ui/dialogs/poppers/grid-context-menu`; `ListBox.story.ts:7` and `Tree.story.ts:8` import `api/events/events`; `Tree.story.ts:7` imports `components/icons`. `editors/storybook/storyRegistry.ts:11+` imports them back.
  - Singletons: `uikit/Notification/AlertsBar.ts:106` (`alertsBarModel`), `uikit/Progress/progressModel.ts:18` (`progressState`).
- **Problem:** `uikit-vs-components-split.md:10` says UIKit may depend only on `core/`, `theme/` and other UIKit modules, so that it stays extractable.
  - `ImageViewportView` imports an editors module for one function, `copyPngBlobToClipboard` (`:195`). That pulls IPC and the app API into UIKit and creates an import cycle uikit ↔ editors/shared.
  - Every story type-imports from `editors/`, and a few stories import app modules at runtime.
  - The alert bus and the progress/screen-lock state are app services, driven from `api/ui.ts`, that live as module singletons inside UIKit.
- **Refactor:**
  1. Inject the clipboard dependency: add `onCopyImage?: (blob: Blob) => Promise<void>` to `ImageViewportProps`. `ImageView`, `SvgBodyView` and `MermaidBodyView` pass `copyPngBlobToClipboard`; with no handler, the Ctrl+C branch is skipped. Move `image-raster.ts` ownership so `image-export` imports UIKit one way only, which is already the case once the back-edge is gone.
  2. Move `editors/storybook/storyTypes.ts` to `uikit/shared/story-types.ts`, since it is UIKit's own catalog contract. Replace the three app imports in stories with UIKit-local stand-ins: `core/events/context-menu` for `ContextMenuEvent`, `createIconElement` for icons, and `openMenu` for the grid menu.
  3. Optional: keep `AlertsBarView` and `ProgressOverlayView` in UIKit, but move the singletons (`alertsBarModel`, `progressState`, `createProgress`, `addScreenLock`) to `api/` (for example `api/internal/alerts.ts`) and inject them into the views.
- **Risk / notes:** Step 1 changes three call sites. Step 3 touches `api/ui.ts` and ai-vision namespaces (`scripting/ai-vision/namespaces/ui-alerts.ts`), so coordinate with the API reviewer.

### UIK-8: The `components/` boundary has drifted: an undocumented folder with an `editors/base` cycle, icons reaching into the board editor, and `ui/dialogs` dependencies
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/renderer/components/pipe-status/` (6 files, 529 lines). `page-pipe.ts:3-5` imports `editors/base/EditorModel`, `editors/base/TextHostEditorModel` and `editors/text/TextEditorModel`, while `editors/base/EditorStatusBarView.ts:4-5` imports `components/pipe-status`.
  - Docs that omit `pipe-status`: `doc/standards/uikit-vs-components-split.md:20-28`, `doc/standards/component-guide.md:13`, `src/renderer/components/CLAUDE.md`.
  - `components/icons/language-icon-resolver.ts:64-69` and `icon-elements.ts:2` → `editors/board/*`.
  - `components/tree-provider/{item-crud-actions,os-clipboard,plural-actions,tree-drop-actions}.ts` → `ui/dialogs/dialog-buttons`.
  - `CategoryViewImpl.ts:1` → the `ui/dialogs` barrel.
  - `file-grid/FileGridView.ts:3` and `git-tree/GitTreeView.ts:13` → `ui/dialogs/poppers/grid-context-menu`.
- **Problem:** The split doc lists seven sanctioned `components/` folders.
  - `pipe-status` is an eighth, added by EPIC-116, that nobody documented. It imports concrete editor model classes, which makes `editors/base` and `components/` mutually dependent.
  - `components/` is meant to sit below `editors/` and `ui/`, yet the icon resolver depends on the board editor's registry and icon cache, and the tree-provider actions depend on the `ui/dialogs` layer.
  - The `ui/dialogs` dependency is mostly for `DialogButton`, a set of button-id constants, and for `showAppPopupMenu` and `showGridContextMenu`.
- **Refactor:**
  1. Move `subscribePagePipe` (`page-pipe.ts`) into `editors/base/` (next to `EditorStatusBarView`) or onto `PageModel`, so `pipe-status` depends only on `IContentPipe`. Then add `pipe-status` to the three docs, or move the whole folder under `editors/base/status/` if its only consumers are the status bar and the page loading shell.
  2. Invert the board-icon dependency: `language-icon-resolver` exposes `registerFileIconResolver(fn)` / `registerIconSource(subscribe)`, and the board editor registers itself at startup. Keep `createBoardGlyphElement` where it is, injected the same way.
  3. Move `DialogButton` constants to a neutral module (`api/ui-dialog-buttons.ts` or `core/`) and route popup menus through `ui.showPopupMenu` on the `api/ui` facade instead of `ui/dialogs` internals.
- **Risk / notes:** These are mechanical moves. Check dynamic-import boundaries: board code must not be pulled into the main bundle by the registration.

### UIK-9: The tree-provider views hand-build fake Panel/Text DOM, override primitive `data-type`s, and keep React-era "Impl" naming
- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/components/tree-provider/TreeProviderViewImpl.ts:198-222`, `:233-239`, `:53`, `:151`; `CategoryViewImpl.ts:166-194`, `:249-254`; `CategoryView.css:39-47`; `components/tree-provider/index.ts` (barrel used by 5 importers while 9 other imports bypass it)
- **Problem:**
  - **Hand-imitated Panel markup.** Instead of `createPanelElement` and `createTextElement`, which 800+ call sites use, both views set `className = "panel-root"`, `dataset.component = "panel"` and `dataset.direction` by hand.
    - They overwrite `data-type` with app values (`"tree-provider-error"`, `"category-footer"`, `"category-tile-focus"`). `model-view-pattern.md:300-303` and `component-guide.md:31` forbid this.
    - `CategoryViewImpl` also sets `data-align`, `data-gap`, `data-padding-x` and `data-background` (`:185-188`), which Panel's CSS never reads (Panel uses `data-bg` and inline styles). The real styling is re-stated in `CategoryView.css:40-47`, so the attributes are dead decoration that misleads anyone reading the DOM.
  - **Untranslated literal.** `"No content"` is an untranslated literal (`TreeProviderViewImpl.ts:151`).
  - **Leftover naming.** The `…Impl` suffix (TreeProviderViewImpl, CategoryViewImpl) is a leftover from when a React `TreeProviderView` face existed; the CSS files are still `TreeProviderView.css` and `CategoryView.css`. `modelProps = (props) => props` and `type TreeProviderViewModelProps = TreeProviderViewProps` (`TreeProviderViewModel.ts:103`) are identity indirections.
- **Refactor:**
  - Build these regions with `createPanelElement({ name, direction, borderTop, background, … })` and `createTextElement`, with app-specific hooks on `data-name` or an extra class.
  - Delete the dead attributes and the duplicated CSS.
  - Rename `TreeProviderViewImpl` to `TreeProviderView` and `CategoryViewImpl` to `CategoryView`. There are about 12 import sites.
  - Drop the identity aliases.
  - Either make `components/tree-provider/index.ts` the only entry point or delete it. The coding style prefers direct imports, so delete it.
- **Risk / notes:** Check that no agent automation or guide addresses `[data-type="tree-provider-search"]`, `"category-footer"` or `"category-tile-focus"`; grep `assets/guides` and `qa/`. If one does, keep the hook as `data-name`.

### UIK-10: Dead React-era leftovers: barrels, version counters, impossible props, stale comment archaeology
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/uikit/index.ts` (83 lines, 11 importers, almost all `MenuItem`).
  - 43 `uikit/*/index.ts` files, nearly all one-line type re-exports. 20 have zero importers; most of the rest are imported only by `uikit/index.ts`.
  - `uikit/shared/overlayRegistry.ts:20-25`, `:59-62` and `tooltipRegistry.ts:33-38`, `:117-120`: `version` and `getVersion()` "for `useSyncExternalStore`", with no callers.
  - `uikit/Popover/PopoverModel.ts:77` (`children?: SlotContent`), which can only throw (`PopoverView.ts:56-58`, `:92-94`).
  - `PopoverViewProps.contentView` is typed optional but required at runtime. The cast `(this.contentView as IOwnedView & { mount(): unknown }).mount()` (`PopoverView.ts:99`; also `editors/log-view/items/DialogContainer.ts:27`) hides a missing `IMountableView` type, which `CategoryItemsViewHandle` (`CategoryViewModel.ts:82-85`) re-declares by hand.
  - `TreeModel.ts:538-553`: ten "compatibility delegates" (`onDragStart = this.dnd.onDragStart`, …).
  - Stale comments that cite deleted code:
    - `SelectModel.ts:342`, `:654-659` (`:520`, `:535`, `:556`, `:577` of the removed React file).
    - `SelectModel.ts:708` (`SettingsSections.tsx`, which no longer exists).
    - `TreeProviderViewModel.ts:861` (`TreeProviderView.renderItem onChevronClick`).
    - `CategoryViewModel.ts:52` ("Only list is implemented", but tiles ship).
    - `TreeModel.ts:35` ("Co-opted by from the V1 declaration").
  - A double-encoded comment in `components/icons/language-icon-resolver.ts:72`, `:126` and `:247` (`Language â†’ Icon`).
- **Problem:** Each of these items costs readers time or lies about the contract:
  - A props type that advertises a value which throws.
  - An optional field that is mandatory.
  - A version counter that nothing reads.
  - Comments that tell the reader to look at line `:556` of a file that is gone.

  About 23 UIKit and components files still narrate the De-React conversion ("the prior implementation", "formerly the effect at…", "V1-compatible") instead of describing current behaviour.
- **Refactor:**
  - Delete `uikit/index.ts` and the per-folder one-line `index.ts` files, except `DataGrid` and `Menu`, which are real surfaces. Point the 11 importers at `uikit/Menu`, `uikit/shared/slots` and `uikit/Progress`.
  - Remove `version` and `getVersion` from both registries.
  - Delete `PopoverProps.children`, make `contentView` required, and add `export interface IMountableView extends IOwnedView { mount(): unknown }` to `vanilla-view.ts`. Use it in Popover, `CategoryItemsViewHandle` and DialogContainer.
  - Inline the DnD delegates: `TreeView` calls `model.dnd.*`.
  - Rewrite the archaeology comments to state the current invariant only, and fix the mojibake.
- **Risk / notes:** These are all type-checked deletions. Rerun the "dead faces and barrels" importer sweep from `component-guide.md:137-143`.

### UIK-11: DOM-attribute helpers and rest-prop blacklists are copied into every view
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `setOrRemove`/`toggle` (or `setAttr`/`toggleAttr`): `AutocompleteView.ts:437-445`, `ListBoxView.ts:567-575`, `ListItemView.ts:342-350`, `MultiListBoxView.ts:424-432`, `MultiSelectView.ts:358-366`, `SelectView.ts:385-393`, `TreeItemView.ts:466-474`, `TreeView.ts:649-657`.
  - `cssLength`: eight copies, including `CollapsiblePanelStackView.ts:59`, `ProgressBarView.ts:36`, `TextareaView.ts:81`.
  - Hand-maintained rest-prop exclusion lists: `TreeView.ts:610-640` (45 names), `ListBoxView.ts:535-558`, `PopoverView.ts:167-215` (twice). 45 `eslint-disable no-unused-vars` in UIKit.
- **Problem:** The same three helpers are pasted into eight files.
  - Each rest-prop blacklist must be extended whenever a prop is added. If it is not, the new prop is silently forwarded as a DOM attribute, or as an `on*` listener on the root.
  - The blacklists duplicate the prop interface by hand.
- **Refactor:**
  - Move `setOrRemoveAttr`, `toggleAttr` and `cssLength` into `uikit/shared/dom-props.ts`, which already owns `applyRestProps`.
  - Replace the destructuring blacklists with a `splitProps(props, OWN_KEYS)` helper, where `OWN_KEYS` is a `const` tuple typed `satisfies readonly (keyof TreeOwnProps)[]`. Derive the props type as `TreeOwnProps & Omit<NativeHTMLAttributes, keyof TreeOwnProps>`, so a missing key becomes a type error.
- **Risk / notes:** This is mechanical. Do it after UIK-4 and UIK-5 so the largest copies disappear first.

### UIK-12: `components/` mixes model generations, and two migrations are half done (FileList → FileGrid, ImperativeSplitter vs SplitterView)
- **Priority:** P3
- **Effort:** M
- **Where:**
  - Plain classes that hold their own `TComponentState`, `disposed` flag and `DisposableStore`: `components/file-search/FileSearchModel.ts:103-135`, `git-tree/GitTreeModel.ts:58-60`, `GitChangesModel.ts:41`, `GitBranchesModel.ts:51`.
  - Driver-based `TComponentModel`: `tree-provider/*`, `file-list/FileList.ts:37`, `pipe-status/PagePipeStatusModel.ts:38`.
  - Imperative non-view classes: `page-manager/ImperativeSplitter.ts:13-60`, which uses an inline `Object.assign(style, {...})` with a hard-coded colour variable, plus `GroupContainer.ts:19` and `PageSlot.ts:10`.
  - The same try/collect-first-error cleanup loop, hand-rolled at `AppPageManagerView.ts:71-100`, `:140-160` and `PageManagerView.ts:32-50`.
  - Parallel flat file lists: `file-list/FileListView.ts` (ListBox; used by `ui/sidebar/RecentFileListView.ts`, `editors/git-tree/CommitDiffPanel.ts`) and `file-grid/FileGridView.ts` (DataGrid; `GitChangesView.ts`), which the docs call "the eventual FileList replacement".
- **Problem:** Four lifecycle shapes coexist for the same job of "a stateful helper with cleanup", and each re-implements disposal checks that `TModel`/`TComponentModel` and `DisposableStore.dispose()` already provide.
  - `ImperativeSplitter` is a second splitter implementation with inline styling, next to `uikit/Splitter/SplitterView`.
  - The FileList→FileGrid migration stopped after one consumer, so two list implementations of the same rows (icon, path, click) are maintained.
- **Refactor:**
  1. Make `FileSearchModel` and the three git models extend `TModel<State>` and use its `disposables` and `isLive`. Delete their private `disposed` and `DisposableStore` fields.
  2. Rebuild `ImperativeSplitter` around a `SplitterView` handle plus a small `SplitLayout` controller that owns the pane positions. Move its styles to `AppPageManagerView.css`.
  3. Replace the hand-rolled cleanup loops with a `DisposableStore` per page slot.
  4. Either finish the FileGrid migration (Recent files and CommitDiffPanel) and delete `file-list/`, or drop the "eventual replacement" claim from the docs and keep both on purpose.
- **Risk / notes:** The page-manager changes touch iframe and webview reparenting avoidance. Preserve the absolute-positioning approach, and change only who builds the handle.

## Cross-area notes
- **Docs (doc reviewer).**
  - `doc/standards/model-view-pattern.md:403` cites `TreeProviderViewImpl.ts:327-399` as the stable-callback reference. The line numbers drifted, and the same file's `treeProps()` builds fresh arrows (UIK-5).
  - `component-guide.md:27` still lists "Rule 6 — `ComponentSet` descriptor pattern", while `uikit/CLAUDE.md` Rule 6 now says the opposite ("do not invent a descriptor registry").
  - `uikit/CLAUDE.md` is 917 lines, and much of Rule 9 documents workarounds for the mechanisms in UIK-4 and UIK-5. Shrink it when those land.
  - `uikit/CLAUDE.md:846-863` still prescribes `uikit/tokens.ts` and `color.ts` imports for styling, which contradicts its own static-CSS custom-property rule.
- **Content/providers (content-pipeline reviewer).** UIK-1 step 2 and UIK-3 step 2 need `FileTreeProvider` (`content/tree-providers/FileTreeProvider.ts:61-63`, `:224-240`) to own watch-batch classification and to declare its capabilities. `MnemeTreeProvider.watch` (`:200`) has the same undeclared shape.
- **Editors (editors reviewer).**
  - The pooled-row pattern (UIK-4) is repeated in `editors/link-editor/LinksListView.ts`, `LinksTilesView.ts` and `editors/log-view/LogBodyView.ts`.
  - `editors/shared/image-export.ts:8` imports `uikit/ImageViewport/image-raster`, the other half of the UIK-7 cycle.
  - `editors/log-view/items/DialogContainer.ts:27` has the same `IOwnedView & { mount() }` cast (UIK-10).
- **API/ui (API and app-shell reviewers).**
  - `api/ui.ts` drives the UIKit-resident `alertsBarModel` and `progressState` singletons (UIK-7 step 3).
  - `ui/dialogs/poppers/showPopupMenu.ts` is a third menu entry point next to `uikit/Menu/openMenu` and direct `MenuView`. It is acceptable because it adds app defaults, but `DialogButton` and the popup helpers should be reachable without importing `ui/dialogs` internals (UIK-8).
- **Tree consumers.** Six editor/ui trees (`BoardsTreeView`, `GitRefsView`, `ToolsTreeView`, `EditorsTreeView`, `SettingsView`, `AboutGuideBrowserView`) would benefit from controlled expansion (UIK-2) but need no change for it.

## Keep
- **The `VanillaView` lifecycle base** (`uikit/shared/vanilla-view.ts`): explicit `own`, `child`, `listen` and `bind`, FIFO disposal, and rollback on a failed mount. It is one consistent component pattern across all of UIKit, and the React-era generations are gone from the shipped code.
- **The av-grid boundary** (`uikit/DataGrid/index.ts`): one documented import surface with zero direct `av-grid` imports elsewhere. This is the model for wrapping any third-party engine.
- **`TreeModel.mutate()` as the single state-write funnel**, with `TreeDndModel` and `TreeKeyboardHandler` as focused submodels that reach state only through `mutateState`. This is good decomposition inside a large component.
- **The tree-provider action modules** (`item-crud-actions.ts`, `item-menus.ts`, `plural-actions.ts`, `tree-drop-actions.ts`, `drop-dispatch.ts`): pure, provider-parameterised functions with a small context object (`ItemCrudContext`). UIK-3 builds on these instead of replacing them.
- **Small primitives such as `SwitchView`, `SpacerView` and `ButtonView`**: a direct view, explicit props, `data-*` state and co-located CSS. This is the template the doc describes, followed exactly.
- **`KeyedList`, `SubtreeSwap` and `fillSlot`** as the only structural helpers: one sanctioned way to do keyed lists, conditional branches and slots.
