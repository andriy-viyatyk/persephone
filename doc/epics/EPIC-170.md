# EPIC-170: Refactoring Phase 6.7 part 2 — controlled tree expansion, one lazy-load owner, `ProviderTreeStore` and the `TreeProviderViewModel` split

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirtieth epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 2 of roadmap item **6.7,
Tree and UIKit**: findings **UIK-2** and **UIK-1** in `doc/reviews/refactoring-2026-11/09-uikit.md`, in the roadmap's
order (UIK-3 → UIK-2 → UIK-1; UIK-3 was done in [EPIC-169](EPIC-169.md)).

The code was checked on 2026-11-14, after EPIC-169. The findings still hold:

- **Expansion owned twice (UIK-2 step 1).** `uikit/Tree/TreeModel.ts` keeps expansion as internal state
  (`TreeState.expanded`) with `defaultExpandedValues` / `defaultExpandAll` hints. The provider tree
  (`components/tree-provider/TreeProviderViewModel.ts`, 1,139 lines) holds a `TreeController` back-reference to the
  child's model (`setTreeModel`), two hint maps (`initialExpandMap`, `savedExpandMap`) and `expandedResolver`, merges
  the two sources in `buildTree`, `setSearchText`, `visibleHrefs`, and resets expansion by bumping `searchKey`, which
  makes `TreeProviderViewImpl.ts:156-186` dispose and recreate the whole `TreeView` on every deep ↔ shallow search
  crossing. `getState()` persists only `treeModel.getExpandedMap()`, i.e. explicit toggles, not the hint-restored
  expansion.
- **Lazy loading owned twice (UIK-2 step 2, D11).** `Tree`'s `loadChildren` / `onLoadError` / `getAncestorValues`,
  `TreeState.loading`, `runLoadAndExpand` and the slow `revealItem` path are used only by `Tree.story.ts`. `revision`
  is written (`TreeModel.ts:587`) and never read; the comment at `types.ts:283-285` claiming it forces a re-walk is
  false.
- **Unused custom renderer (UIK-2 step 3).** No production `Tree` passes `renderItem`; the "custom" cell kind and its
  repaint-signature slots exist for stories (the `ListBox` copy is checked by the planner).
- **`TreeProviderViewModel` still mixes jobs (UIK-1).** Four "list → generation check → `updateNodeChildren` →
  recompute `displayTree` → `state.update`" sequences (`buildTree`, `loadChildrenIfNeeded`, `loadChildrenForPaths`,
  `queueWatchRefresh`); the watch closure (`:276-345`) carries file-system and git knowledge (`/.git/head`,
  `/.git/objects`, the 100-change threshold, its own `find` and `normalize`); search filtering (`filterDirectoriesOnly`,
  `filterTreeDeep`, `filterTreeShallow`, the length ≥ 3 deep switch) sits in the model next to pure tree utilities.
  UIK-1 step 5 (item commands) was done by EPIC-169's `ProviderItemController`; step 4 is UIK-2.

## Goals

- **UIK-2.** `Tree` accepts an optional controlled expansion (`expanded` + `onExpandedChange`); uncontrolled consumers
  keep `defaultExpanded*` unchanged. The provider tree owns one expansion map: `TreeController`, `setTreeModel`,
  `initialExpandMap`, `savedExpandMap`, `expandedResolver`, `searchKey` and the `TreeView` remount are gone; a deep
  search swaps the controlled map and restores it on clear. `Tree`'s own lazy-load path, `TreeState.loading`,
  `revision`, the slow reveal path, the loading chevron and the "custom" `renderItem` kind are deleted.
- **UIK-1.** `FileTreeProvider` classifies a watch batch itself (the `.git` markers, path normalization and the
  100-change threshold move next to the file-system code); a pure `tree-search-filter.ts` module owns the display-tree
  filters and shares its word-match predicate with `CategoryViewModel.filterItems`; `ProviderTreeStore`
  (`components/tree-provider/provider-tree-store.ts`) owns the immutable node tree, the generation token and one
  `loadChildren(hrefs)` used by build, lazy expand, reveal, restore and watch, plus the pure node utilities.
  `TreeProviderViewModel` keeps prop adoption, selection, wiring the store and expansion to state, and persistence.

## Decisions this epic acts on

- **Scope: all of UIK-2 and UIK-1, five tasks.** UIK-2 splits into the deletion (steps 2–3, a pure UIKit removal that
  touches no consumer) and controlled expansion (step 1, the risky one). UIK-1 splits into its three independent
  extractions (watch classification, search filter) and the store, which is planned last against the code the other
  four leave behind. The rest of 6.7 (UIK-4/5, UIK-6, UIK-9 to UIK-12) stays for later epics.
- **Order.** US-1962, US-1964 and US-1965 are planned in parallel (US-1962 touches only `uikit/Tree`/`uikit/ListBox` and
  stories; US-1964 and US-1965 touch different regions of `TreeProviderViewModel` plus their own new modules).
  Implementations run one at a time: US-1962, US-1965, US-1964. US-1963 is planned after those three land, US-1966
  after US-1963. A plan written before an earlier task landed is re-checked against the current code before
  implementation.
- **D11: delete `Tree`'s lazy-load path (UIK-2 option A).** Storybook's Tree demo loses its lazy toggle; that is
  accepted (stories are a dev aid). The provider store keeps its own node tree anyway.
- **Controlled expansion is additive.** Seven `TreeView` consumers exist; only the provider tree uses the controlled
  mode. `GitRefsView`, the boards/tools/editors trees, Settings and About keep `defaultExpanded*` and must behave
  exactly as today. In controlled mode `TreeModel` derives rows from the supplied expansion and writes nothing to
  `state.expanded`; toggles, expand/collapse-all, keyboard expand/collapse, `collapseDescendants`, `canCollapse` and
  `revealItem`'s ancestor expansion all go through `onExpandedChange`.
- **Deep search without a remount.** Today a deep search remounts `TreeView` with `defaultExpandAll`, so every row
  starts expanded and the user may collapse rows during the search; clearing restores the pre-search effective
  expansion. The provider model keeps exactly that: entering deep search saves the effective map and switches to an
  "everything expanded unless collapsed in this search" map; leaving restores the saved map. The planner lists what the
  remount resets today besides expansion (scroll position, active row, focus, keyboard cursor) and keeps every
  user-visible reset explicitly (for example scrolling to the top), so the visible result is unchanged.
- **Persisted expansion.** The `expandedPaths` format in the saved state is unchanged. With one owner the saved list
  becomes the effective expansion. If today's `getState()` really drops restored-but-untouched expansions on the next
  save (it reads only explicit toggles), that is fixed and recorded as a behaviour change; the planner confirms it
  against the Explorer's persistence path first.
- **Watch classification belongs to the provider.** `FileTreeProvider` (and `MnemeTreeProvider` only if it has the same
  shape) emits an already-classified batch (`{ relist: string[] } | { rebuild: true }` or equivalent) through the
  capability contract in `content/tree-providers/tree-provider-capabilities.ts`; the tree just re-lists what it is
  given. The public `api/types/io.tree.d.ts` does not change. Every rule (the markers, the threshold, normalization with
  `fpNormalizeForCompare`, when a full rebuild happens, the selection pruning after a patch) moves verbatim.
- **Search filter.** Pure functions, no model state: `computeDisplayTree(tree, query, showLinks, expandedKeys)`. The
  deep/shallow switch at length ≥ 3 and the word split stay byte-for-byte; `CategoryViewModel.filterItems` uses the
  same word-match predicate only if its current matching is identical — any difference is recorded and kept.
- **Store size target.** UIK-1 aims for a `TreeProviderViewModel` of about 300 lines; this epic accepts whatever is
  left once the store, filter, watch classification and expansion have moved out, and records the count. The hard-won
  ordering comments (atomic inline refresh before publish, root seeding, US-1039) move verbatim with their code.
- **Where things live.** `ProviderTreeStore` and `tree-search-filter.ts` in `components/tree-provider/` (provider
  coupled, so not `uikit/`); the controlled-expansion API in `uikit/Tree/types.ts`. No `await import()` to break a
  cycle.
- **Behaviour is kept.** Rows, order, labels, icons, chevrons, the expanded/collapsed state after build, refresh, watch
  ticks, reveal, collapse-all, search enter/exit and restart restore; scroll position across watch refreshes;
  selection pruning; menus, drag/drop and keys. Rendered DOM structure, CSS classes and every `data-name` stay
  identical (before/after structural fingerprints of the Explorer tree, the folder page, the git refs tree, the boards
  and tools trees, Settings and About). Only the recorded changes above may differ.
- **Contracts that must not change:** the saved tree state (`expandedPaths`, `selectedHref`, `selectedHrefs`), the
  public `api/types/io.tree.d.ts`, the script API and facades (including the Explorer `revealItem`/`expandPath`/
  `collapsePath`), ai-vision paths and output, MCP `call`, `data-name`, `window.persephone` (not touched, so no
  `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1). No board rule moves (2). God files only shrink (3):
  `TreeProviderViewModel.ts` (1,139), `TreeModel.ts` (925), `TreeView.ts` (657), `TreeProviderViewImpl.ts` (512),
  `CategoryViewModel.ts` (638). Plans name the owner of every moved rule (4). No `await import()` (5).
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent, on temp folders under `%TEMP%`; no page, dialog or window the agent did not open is touched,
  and the app is not restarted while other pages are open. `npm run build-prod` is run with `.vite/build` backed up
  and restored, so the running dev app keeps opening windows.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1962 | Delete `Tree`'s own lazy-load path, `revision` and the custom `renderItem` kind (UIK-2 steps 2–3) | Done |
| US-1963 | Controlled expansion in `Tree`; one expansion owner in the provider tree (UIK-2 step 1) | Done |
| US-1964 | Pure `tree-search-filter` module shared with the folder page (UIK-1 step 3) | Done |
| US-1965 | `FileTreeProvider` classifies watch batches (UIK-1 step 2) | Done |
| US-1966 | `ProviderTreeStore` with one `loadChildren`; thin `TreeProviderViewModel` (UIK-1 steps 1 and 6) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the god files
  above. For every exported symbol that moves, is renamed or is deleted, list its importers and update them (no
  re-export shims). Every `data-name` in a touched view listed and shown preserved. List every facade member that
  reaches the touched code and show its delegate. No unit tests or harnesses.
- **US-1962.** Every symbol deleted with its only users (story lines); proof that no production consumer passes
  `loadChildren`, `onLoadError`, `getAncestorValues` or `renderItem` to `Tree`; what `revealItem` keeps (the fast path)
  and that every caller's ancestors are already loaded; the `TreeItemView` loading-chevron branch; the `ListBox`
  `renderItem` "custom" kind: consumers (`MultiListBoxView` and others), and remove it only if none; the repaint
  signature slots removed with it.
- **US-1963.** The controlled API in `types.ts` and every `TreeModel` write to `expanded` mapped to the controlled
  path (toggle, expand/collapse-all, keyboard, `collapseDescendants`, reveal, drop auto-expand if any); the provider
  model's single map: how it seeds (restored `expandedPaths`, root expanded, others collapsed), how it handles hrefs
  (`hrefKey`), every reader of today's merged expansion (`buildTree`, `visibleHrefs`, `getExpandedPaths`, `getState`,
  `collapseAll`, `revealItem`/`expandPath`/`collapsePath`, `onExpandChange`, deep search) and its replacement; what the
  `searchKey` remount resets today and how each user-visible reset is kept; the `getState()` persistence question
  above, answered against the Explorer's code.
- **US-1964.** The three filters and the deep/shallow switch moved verbatim with their callers; the shallow filter's
  expansion input; `CategoryViewModel.filterItems` side by side with the tree's word match and the decision.
- **US-1965.** The watch closure today line by line → what moves into `FileTreeProvider` and what stays (the patching
  of the node tree and the selection pruning stay with the tree); the classified payload type in the capability
  contract; every watchable provider and its payload today (EPIC-169 recorded them); `MnemeTreeProvider`'s watch shape
  and whether it takes part; the serial queue and error logging kept.
- **US-1966.** The four load sequences side by side → `ProviderTreeStore.loadChildren`; the generation token rules
  (provider change, dispose); `findNode`/`findParent`/`updateNodeChildren`/`toNode`/`filterTreeItems` moved; the
  no-op `toNode` branch, the inline `import()` type and `err.message ||` sites (`errMessage()`); what the model keeps
  and its final line count.

## Out of scope

- UIK-4/5 (pooled-row host, repaint tracker), UIK-6 (shared list filter and navigation), UIK-9 to UIK-12: later 6.7
  epics.
- Roadmap item 2.4 moves.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-169. Findings re-checked against the code (see Overview). Codex weekly window had 26% left
  and the 5-hour window 78%; the policy pick is Luna for planning as well.
- The user had pages open in the main window (a browser page, boards, a Markdown page), so the app is treated as in
  use: no restart, live checks in a separate window, build-prod with `.vite/build` backed up and restored.

### 2026-11-14 — first wave (US-1962, US-1965, US-1964)
- **US-1962.** Plan accepted without corrections after checking it against the source: no production `Tree`/`ListBox`
  consumer passes `loadChildren`, `onLoadError`, `getAncestorValues` or `renderItem`; `needsLazyLoad` only mattered with
  a loader, so `getHasChildren` rows keep toggling through `onExpandChange`; the keyboard handler's `lazyChildren` test
  stays. The `ListBox` custom kind went too (only its story used it). `TreeModel.ts` 925 → 794, `TreeView.ts` 657 → 628,
  `types.ts` 397 → 317.
- **US-1965.** Plan accepted; the implementation brief pinned the classifier to the provider's own `rootPath`,
  `fpNormalizeForCompare` and `isKeyInside(..., { allowSame: false })`, and the `ended`/`hasReceivedBatch` forwarding.
  The changed-file check stays in the tree against the same snapshot (relist targets carry `changedPaths` only while
  every contributor is a `changed` event). A misplaced JSDoc was moved back onto `watch` by hand.
  `TreeProviderViewModel.ts` 1,139 → 1,131.
- **US-1964.** Correction: the node type does not belong to the search module; `TreeProviderNode` lives in the
  type-only `components/tree-provider/tree-provider-node.ts`, which US-1966's store will sit beside.
  `matchesSearchWords` is shared with `CategoryViewModel.filterItems` (identical rule). `TreeProviderViewModel.ts`
  1,131 → 1,047.
- **Live checks** (HMR plus a separate test window on a `%TEMP%` fixture; the app was not restarted because the user
  was working in the main window and closed the test window twice): Explorer flow (chevron expand/collapse, facade
  expand/collapse, shallow and deep search, collapse during deep search, deep → shallow → deep, Escape, collapse-all,
  reveal) row-for-row identical after each task; external create/mkdir/rename/change/delete in loaded and unloaded
  folders identical; folder-page search (5 queries) identical; Settings and About trees identical; Tools hub editors
  tree identical apart from board-icon/board-list changes made outside this work. `build-prod` passes (run with the dev
  build backed up and restored).

### 2026-11-14 — US-1963 (controlled expansion)
- **Corrections sent to the plan:** the projected `expanded` record is cached and compared by identity in
  `TreeModel.setProps` (a fresh record per render would re-derive rows on every keystroke); the provider applies a
  Tree proposal as a delta, never a replacement (the proposal only covers loaded rows, so replacing would drop
  restored-but-unloaded paths); the canonical map publishes through state so the view re-renders synchronously; deep
  search is a set of keys collapsed during this search (rows that appear as the query grows start expanded, as with
  `defaultExpandAll`); reveal loads ancestors, publishes their expansion, then asks the view to scroll; collapse-all
  makes the map root-only.
- **Comments.** The implementation run deleted ~260 comment lines across the four tree files to meet line targets,
  including the ordering comments this epic says must move verbatim. A follow-up run restored every comment whose
  code survives and rewrote the ones about removed mechanisms. Guardrail 3 is read as code lines; both counts are
  recorded.
- **Fix after review:** during deep search leaf rows lost `data-state="open"` (the old `defaultExpandAll` marked every
  row expanded); the projection now marks every row in deep mode, restoring the DOM.
- **Behaviour changes (accepted, recorded):** (1) persistence: restoring `[root, A]` and then expanding `B` used to
  save `[B]` (only explicit Tree toggles were serialized), dropping the restored paths on the next restart; it now
  saves `[root, A, B]`. A collapse during deep search no longer saves the temporary search map. (2) The shallow filter
  (query of 1–2 characters) now sees the effective expansion, so a restored-but-untouched expanded folder has its
  children filtered like any other expanded folder (before, it was treated as collapsed and listed all children).
  Observed live: after deep → shallow ("de"), `alpha` lists only matching/collapsed-directory children instead of all.
- **Line counts.** `TreeModel.ts` 794 → 830 total, 566 → 598 code; `TreeView.ts` 628 → 607 total, 446 → 422 code;
  `TreeProviderViewImpl.ts` 512 → 511; `TreeProviderViewModel.ts` 1,047 → 1,160 total, 769 → 892 code (the expansion
  owner moved in). Over HEAD, `TreeModel.ts` code is still 639 → 598. US-1966's scope was extended to extract the
  expansion owner into `ProviderTreeExpansion` beside `ProviderTreeStore`, so the model shrinks over the epic.
- **Live check** (separate test window; HMR; no restart): the extended Explorer flow (chevrons, facade expand/collapse,
  shallow/deep search, collapse during deep search, query growth during deep search, deep → shallow → deep, Escape,
  clear, collapse-all, reveal) row-for-row identical apart from change (2); visible-row DOM structure identical after
  collapse-all; watch flow identical; Settings and About trees (uncontrolled) identical. Not verified live: restart
  persistence (needs an app restart, skipped because the user was active) and the GitRefs tree (needs a repository in
  the test window; its uncontrolled path is unchanged code).

### 2026-11-14 — US-1966 (`ProviderTreeStore`, `ProviderTreeExpansion`)
- **Scope extension (decided before planning):** because US-1963 put the expansion owner into the model, US-1966 also
  extracts `ProviderTreeExpansion` (`components/tree-provider/provider-tree-expansion.ts`: canonical href-keyed map,
  cached display projection, deep-search snapshot and collapsed-key set, proposal deltas, collapse-all, `expandedPaths`
  serialization; no provider I/O). The node utilities (`findNode` with an optional comparator, `findParent`,
  `updateNodeChildren`, `toNode`, `filterTreeItems`) sit beside the node type in `tree-provider-node.ts`.
- **Corrections sent to the plan:** the one `ProviderTreeStore.loadChildren(tree, hrefs, mode, isCurrent)` keeps each
  sequence's rules through an explicit mode (`load-unloaded`: `provider.list`, a failed listing makes the node
  loaded-empty; `relist-loaded`: `listIncremental` on loaded parents, keeps loaded descendants, any error or kind change
  abandons the patch) and returns a tree or `null` without publishing; every caller keeps its own staleness fallback
  (build: silent; lazy load and restore/reveal: silent on dispose/provider change, queued refresh on a generation or
  snapshot race; watch: rebuild) and its single `state.update`; the store gets the expanded hrefs per `buildTree` call
  rather than a stored callback.
- **Bugs fixed after review:** (1) the store was constructed in a field initializer with `this.props.provider`, but
  `TComponentModel` assigns props after construction, so every provider tree failed to mount ("Cannot read properties
  of undefined (reading 'provider')" in the secondary-view error panel); the store now receives its provider in the
  first `setProps`. Typecheck could not catch it; the live check did. (2) The watch patch had started pruning the
  selection to visible rows; the original rule (keep every selected href still present in the patched tree, compared
  with `fpNormalizeForCompare`) is restored.
- **Accepted difference:** `errMessage()` replaces `err.message ||` in the root-list error and the link-import
  notification, so a thrown non-`Error` value now shows its text instead of the fallback.
- **Line counts (HEAD → now, total / code-only):** `TreeProviderViewModel.ts` 1,139 / 843 → 816 / 609;
  `TreeModel.ts` 925 / 639 → 830 / 598; `TreeView.ts` 657 / 473 → 607 / 422; `TreeProviderViewImpl.ts` 512 / 428 →
  511 / 429; `CategoryViewModel.ts` 638 / 410 → 636 / 408. New: `provider-tree-store.ts` (~240),
  `provider-tree-expansion.ts` (~257), `tree-search-filter.ts` (122), `tree-expansion-map.ts` (22),
  `tree-view-props.ts` (34). The UIK-1 target of ~300 lines for the model was not reached; what remains is prop
  adoption, selection, wiring, persistence callbacks, the item-controller adapter and the path facade methods.
- **Live check** (fresh test window after the fix; no restart): the Explorer flow (20 steps) identical to the
  post-US-1963 baseline; the watch flow identical; a `%TEMP%` zip in the archive editor (expand, nested expand,
  collapse) identical; folder-page search identical; Settings and About identical.
- **Completion (2026-11-14).** `/review` (Codex): no defects; it noted the definite-assignment `provider!` in
  `provider-tree-store.ts`, which is kept (the owner assigns it in its first `setProps`, before any build, load or watch,
  and the field says so). `/document` updated `component-guide.md` (controlled expansion, no Tree-owned loading),
  `folder-structure.md` and `key-files.md`; `/userdoc` added the Explorer persistence fix to `whats-new.md`.
  `uikit/CLAUDE.md` was updated by US-1962. No English catalog message changed; `i18n:check` reports every pack
  complete (1672/1672). Roadmap 6.7 part 2 is complete; next: 6.7 part 3 (UIK-4/5, pooled-row host and repaint
  tracker).

