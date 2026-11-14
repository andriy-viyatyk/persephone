# EPIC-171: Refactoring Phase 6.7 part 3 — repaint tracker and pooled-row host

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-first epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 3 of roadmap item
**6.7, Tree and UIKit**: findings **UIK-5** (repaint change-detection) and **UIK-4** (pooled virtual-row hosting) in
`doc/reviews/refactoring-2026-11/09-uikit.md`. The review says to pair them so the tracker and the pooled host land
together.

The code was checked on 2026-11-14, after EPIC-170. The findings still hold, with one drift:

- **Three repaint mechanisms (UIK-5).** `uikit/Tree/TreeModel.ts` keeps eight `applied*` mirrors, pending flags,
  `globalRepaintProps()`, `repaintSignature()` and `deriveRepaintChange()`; `TreeView` runs a `DepsGate` over the
  signature. `uikit/ListBox/ListBoxModel.ts` (414 lines) has eleven `live*` mirrors, pending flags, targeted setters,
  its own signature, and a `TComponentState` documented as "Unused. Kept only so the model has a state object to own".
  `ListBoxView` runs the same gate.
- **Drift (bug #17, repaint half).** `getName` has since been added to Tree's `globalRepaintProps`, but every cell still
  reads `getIconElement`, `getHideChevron`, `renderTrailing` and `trailingElement` (`TreeView.ts:458-473`) and none of
  them is in any list, so changing only one of them repaints nothing. `TreeProviderViewImpl.treeProps()` passes fresh
  arrows for `getHasChildren`, `getHideChevron` and `renderTrailing` and is rebuilt on every hover, so `getHasChildren`
  (a rows input) re-derives every row on each hover.
- **Pooled-row hosting copied (UIK-4).** `ListBoxView.ts` (559) and `TreeView.ts` (607) share the cell-record type, the
  loading/empty/real arm machine with the same hard-coded `"loading…"` text (`ListBoxView.ts:346`, `TreeView.ts:358`;
  `uikitText` is bypassed), `renderCell`/`releaseCell`, the four cell listeners, `activeRecord`, `syncActiveScroll` and
  the `cssLength`/`setOrRemove`/`toggle` helpers. Four views outside UIKit hand-roll the same pooling:
  `components/file-search/FileSearchView.ts` (388), `editors/link-editor/LinksListView.ts` (427),
  `editors/link-editor/LinksTilesView.ts` (592), `editors/log-view/LogBodyView.ts` (243).

## Goals

- **UIK-5.** One declarative `uikit/shared/repaint-tracker.ts`: a component declares which props are rows inputs,
  global (every row) inputs and local (selection/active) inputs once; the tracker diffs previous and next props and
  reports the classification. The `applied*`/`live*` mirrors, the pending flags, `repaintSignature()`,
  `deriveRepaintChange()` and the per-view `DepsGate` wiring for Tree and ListBox are deleted (`DepsGate` stays for the
  simple views where it is the whole story). Every prop a cell reads is declared. `ListBoxModel` becomes a plain class
  with one input channel. `TreeProviderViewImpl.treeProps()` passes stored callback fields.
- **UIK-4.** `uikit/shared/pooled-row-host.ts` (a composition helper, not a base view) owns the `RenderGrid` lifecycle,
  the cell-record `WeakMap`, the row-view set, kind switching, once-per-wrapper listeners and `syncActiveScroll`; a
  sibling `ListShellArms` owns loading/empty/real with a spinner and `uikitText` defaults. `ListBoxView` and `TreeView`
  keep root attributes and row-prop building. `FileSearchView`, `LogBodyView`, `LinksListView` and `LinksTilesView`
  migrate as separate tasks. The pooled-row rules in `uikit/CLAUDE.md` Rule 9 move into the helper's header, with
  `uikit/CLAUDE.md` keeping a short pointer.

## Decisions this epic acts on

- **Scope: all of UIK-5 and UIK-4, six tasks.** UIK-6 and UIK-9 to UIK-12 stay for later 6.7 epics (UIK-11 explicitly
  wants UIK-4/5 done first).
- **Tracker shape.** The roadmap's shape is the target: `{ rows, global, local }` key lists declared once as `const`
  tuples typed against the props interface (`satisfies readonly (keyof P)[]`), compared with `Object.is` per key.
  The tracker is a pure classifier; each model keeps its own row arithmetic (Tree's `deriveRows` + `diffRows`, the
  previous/next active and selected rows). Extra non-prop signals (MultiListBox's `selectionSignal`, the derived
  `selectedKey`) are handled explicitly by the owning model and documented, not hidden in a signature array.
- **Bug #17 repaint half is fixed by declaring what cells read.** Every prop read on the cell path is in exactly one
  list. Adding `getIconElement`, `getHideChevron`, `renderTrailing`, `trailingElement` to Tree's global list is only
  safe together with stable callbacks from `TreeProviderViewImpl.treeProps()` (otherwise every hover repaints every
  row); both land in the same task. Recorded as a behaviour change: changing only one of those props now repaints.
- **ListBox input channel.** One channel. The planner lists every caller of the targeted setters
  (`setItems`, `setSelection`, `setActiveIndex`, …) and why each exists; the default decision is props only (setters
  deleted, callers use `update()`), unless a setter exists for a measured hot path, in which case the plan records it
  and the setters become the only channel for that input.
- **`ListBoxModel` becomes a plain class.** No `TComponentModel`, no fake state. The host view's driver wiring changes
  accordingly; every external `listBox.model` reader keeps working.
- **Pooled host shape.** As in the review: an owner `VanillaView` (for `listen`/`own`), a host element, a
  `RowAdapter<K>` (`rowCount`, `kindFor`, `create`, `update`, `onRowEvent`) and grid options; exposes `repaint(info)`,
  `gridModel` and `syncActiveScroll(index, afterPaint)`. It composes, it does not inherit ("extend `VanillaView`
  directly" stays true). The Rule 9 safety rules (pooled wrappers keep their listeners, no slot cleanup on eviction,
  `keepCellsAttached`, the icon-node host check) are enforced by the helper and documented in its header.
- **Loading text.** The arm's `"loading…"` literal becomes `uikitText("loading")` (catalog "Loading…"). Recorded as a
  visible change (capital L); no new catalog message.
- **Order.** Wave 1 plans US-1967 (tracker + Tree) and US-1969 (pooled host + ListBoxView) in parallel; implementations
  run US-1967 then US-1969. Wave 2 plans US-1968 (ListBox tracker) and US-1970 (TreeView on the host) against the landed
  code; implementations one at a time. Wave 3: US-1971 and US-1972. A plan written before an earlier task landed is
  re-checked against the current code before implementation.
- **Behaviour is kept.** Rows, order, labels, icons, chevrons, selection, active row, hover, scroll position, keyboard
  navigation, drag/drop, context menus, focus and pooled-row reuse while scrolling a long list are unchanged; rendered
  DOM structure, CSS classes and every `data-name` stay identical (before/after structural fingerprints of a Select and
  an Autocomplete popup, the Explorer tree, Settings, the file search results, a Link editor list and tiles view and a
  log view, including after scrolling a long list). Only the recorded changes above may differ.
- **Contracts that must not change:** the public props of `ListBox`, `Tree`, `Select`, `Autocomplete`, `MultiListBox`
  (types may get stricter only where a key list makes them so), `api/types/*.d.ts`, the script API and facades,
  ai-vision paths and output, MCP `call`, `data-name`, `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION`
  bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1). No board rule moves (2). God files only shrink (3): `TreeModel.ts` (830),
  `TreeView.ts` (607), `ListBoxView.ts` (559), `ListBoxModel.ts` (414), `TreeProviderViewImpl.ts` (511) and the four
  migrated views. Line counts are recorded as total and code-only; **comments are never deleted to reach a count**
  (EPIC-170's implementation run did, and had to restore ~260 lines). Plans name the owner of every moved rule (4).
  No `await import()` (5).
- **Live verification limits.** The user is using Persephone (five pages open in the main window). Live checks run in
  a separate window opened and closed by the agent, on fixtures under `%TEMP%`; no page, dialog or window the agent did
  not open is touched, and the app is not restarted while other pages are open. `npm run build-prod` runs with
  `.vite/build` backed up and restored so the running dev app keeps opening windows.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1967 | `repaint-tracker` and Tree adoption; stable `treeProps()` callbacks (UIK-5, bug #17 repaint half) | Done |
| US-1968 | ListBox on the repaint tracker; plain `ListBoxModel` with one input channel (UIK-5) | Done |
| US-1969 | `pooled-row-host` and `ListShellArms`; `ListBoxView` migrates (UIK-4) | Done |
| US-1970 | `TreeView` on the pooled-row host (UIK-4) | Done |
| US-1971 | `FileSearchView` and `LogBodyView` on the pooled-row host (UIK-4) | Done |
| US-1972 | `LinksListView` and `LinksTilesView` on the pooled-row host (UIK-4) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts (total and code-only) before and
  after for every touched god file. For every exported symbol that moves, is renamed or is deleted, list its importers
  and update them (no re-export shims). Every `data-name` and `data-*` attribute in a touched view listed and shown
  preserved. No unit tests or harnesses. Comments describing surviving code move with it.
- **US-1967.** Every prop of `TreeProps` classified (rows / global / local / not-a-repaint-input with the reason, e.g.
  read at event time); a side-by-side of today's `rowsChanged`, `selectionChanged`, `globalRepaintProps`,
  `repaintSignature` and what the cells read, with each difference called out; the exact `RerenderInfo` produced for
  each case before and after (must match except the declared bug fix); what `onStateApplied`/`mutate()` keep;
  `TreeProviderViewImpl.treeProps()` callbacks as stored fields (and every other `TreeView` consumer checked for fresh
  arrows that would now cause repaints: `GitRefsView`, the boards/tools/editors trees, Settings, About); the doc anchor
  in `doc/standards/model-view-pattern.md` that cites `treeProps`.
- **US-1968.** The same classification for `ListBoxProps`; every targeted-setter caller (`Select`, `Autocomplete`,
  `MultiListBox`, `PathInput`, others) and the channel decision; MultiListBox's `selectionSignal` kept working (a
  checked row repaints); the `TComponentModel` → plain class change and every `.model` reader.
- **US-1969.** The `RowAdapter` and host API; every line of `ListBoxView` that moves into the host or the arms; the
  Rule 9 rules each mapped to where the helper enforces them; `uikit/CLAUDE.md` Rule 9 prose moved into the helper
  header with a pointer left behind; Select, Autocomplete, MultiListBox and PathInput popups unchanged.
- **US-1970.** The same mapping for `TreeView` against the landed host; the Tree-only parts that stay (indentation,
  chevrons, DnD gating attributes, `aria-activedescendant`).
- **US-1971 / US-1972.** Each view's pooling code side by side with the host; anything the host cannot express is
  either added to the host generically or kept in the view with the reason recorded.

## Out of scope

- UIK-6 (shared list filter and navigation), UIK-9 to UIK-12: later 6.7 epics.
- Roadmap item 2.4 moves.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-170. Findings re-checked against the code (see Overview). Codex weekly window had 23% left
  and the 5-hour window 97%; the policy pick is Luna for planning as well.

### 2026-11-14 — wave 1 (US-1967, US-1969)
- **US-1967 corrections sent:** the planner wanted to store the fresh callbacks of `EditorsTreeView`,
  `AboutGuideBrowserView`, `GitRefsView` and `SettingsView` too. Those identities are load-bearing today:
  `EditorsTreeView.renderTrailing` reads `editorCategories` and `listBoardUpdates()` at call time and only the fresh
  `getDragData` (a global key) repaints the category chip / update button after a refresh (`TreeModel.sameRow` ignores
  trailing content). The four files stay unchanged (recorded as a follow-up: give them an explicit signal). In
  `TreeProviderViewImpl`, `getHasChildren` reads `props.showLinks` at call time (a `showLinks` change already yields a
  new display tree, so rows re-derive) and the `renderTrailing` wrapper is memoized per owner function, so an owner
  change still repaints. Also pinned the tracker API (`RepaintKeys`, `RepaintDiff`, `createRepaintTracker`) and the
  `contentChanged` rule that keeps `syncActiveScroll` timing.
- **US-1967 extra finding:** `getTrailingVisibility` is also read by every cell and was in no list; it joins the
  global keys with the other four. **Behaviour change (recorded):** changing only `getName`, `getIconElement`,
  `getHideChevron`, `getTrailingVisibility`, `renderTrailing` or `trailingElement` now repaints the rows; hover in the
  provider tree no longer re-derives every row.
- **US-1967 result:** `TreeModel.ts` 830 / 598 → 806 / 580 (total / code); `TreeView.ts` 607 / 422 → 590 / 409;
  `TreeProviderViewImpl.ts` 511 / 429 → 520 / 447 (stored callbacks); new `uikit/shared/repaint-tracker.ts` (35).
  Live (test window, HMR reload): Explorer tree and Settings tree fingerprints identical at top, mid-scroll, bottom and
  back; click-select, ctrl-click, hover, chevron collapse/expand and expanding a folder above the selection repaint the
  right rows.
- **US-1969 corrections sent:** keep `model.setGridRef` on enter/leave (as a generic `onGridModel` host option, Tree
  has the same ref); `lastActiveIndex` stays a view field (it is a repaint-classification input); `leave()` reproduces
  today's teardown (ref cleared, grid destroyed, host removed, row views disposed, host emptied); an adapter can return
  "no cell"; wrapper listeners only for the adapter's declared events (ListBox keeps its four, no drag listeners);
  no speculative measured-grid seam; the adapter is cell-oriented (`row`, `col`) so the tiles view fits later;
  `ListShellArms` in its own file and `cssLength` in `dom-props.ts`.
- **US-1969 result:** `ListBoxView.ts` 559 / 403 → 374 / 289; new `pooled-row-host.ts` (267) and
  `list-shell-arms.ts` (78); the Rule 9 "Native slots inside a virtualized row" subsection moved into the host header
  with a pointer left in `uikit/CLAUDE.md`. One shortened load-bearing comment (FIFO disposal order) was restored by
  hand. Live: Select popup (60 items: open, mid, end, back), Explorer, Settings, Link list and Log view fingerprints
  identical; hover, ArrowDown ×13 with scroll-follow and click-to-choose behave as before. Not exercised live: the
  loading arm text ("loading…" → "Loading…").

### 2026-11-14 — wave 2 (US-1970, US-1968)
- **US-1970** plan accepted (one generic addition: an optional `RowAdapter.updateWrapper` hook, which Tree uses for
  the `draggable` IDL property; ListBox does not implement it). `TreeView.ts` 590 / 409 → 437 / 298;
  `pooled-row-host.ts` 267 → 281. Live: Explorer, Settings, Select and Link list fingerprints identical (apart from
  the selection my own earlier clicks made); click/hover/ctrl-click/chevron/scroll flows identical. Not verifiable
  with synthetic events: drag and drop (Chromium does not start a drag from a script event) — manual test.
- **US-1968 corrections sent:** MultiListBox's changing selection set becomes an ordinary optional ListBox prop
  `selectionSignal` in the tracker's global group (one input channel, no staged cross-call model state; output
  unchanged); each owner (Select, Autocomplete, MultiListBox) sends the complete props object in one `update()`
  per sync (so `scrollToRowAfterPaint` still applies when rows change); Autocomplete's same-file forwarding setters
  are deleted. **Decision:** the epic's "default props only" held — no setter exists for a hot path.
- **US-1968 result:** `ListBoxModel.ts` 414 / 294 → 322 / 240 (a plain class, no fake state, no driver);
  `ListBoxView.ts` 374 / 289 → 291 / 220; `ListBoxProps.selectionSignal` added. **Behaviour change (recorded):** a
  change of only `id` now repaints the rows, so row ids follow the root id. The deleted signature JSDoc's rationale
  (why `rowHeight`/`getContextMenu` are not keys, why a caller-owned selection needs a signal) was restored on the
  key tuples by hand, and two stale `DepsGate` statements in `uikit/CLAUDE.md` Rule 9 were corrected.
- **Bug fixed (pre-existing):** `AutocompleteContentView.syncHeader` read the slot hosts before `createHeaderRow()`
  had created them, so an Autocomplete `header` never rendered. Only the Storybook demo passes a header today.
- **Live (US-1968):** Select popup fingerprints identical; hover, ArrowDown ×13 with scroll-follow and click-choose
  as before; MultiListBox (mounted from its story module in the test window) check/uncheck repaints and survives a
  scroll; Autocomplete (story module) opens, filters, ArrowDown moves the active row, no-match closes, dispose
  removes the popover.

### 2026-11-14 — wave 3 (US-1972, US-1971)
- **US-1972** plan accepted; implementation brief pinned the DOM depth (the composite row view's root is the existing
  intermediate element inside the grid cell, so the host's `fillSlot` nesting reproduces today's tree). Row and tile
  listeners stay on their semantic roots (`events: []`) so `event.currentTarget` seen by the public callbacks is
  unchanged; tiles use one kind for occupied and blank trailing cells. `LinksListView.ts` 427 / 384 → 405 / 367;
  `LinksTilesView.ts` 592 / 543 → 581 / 532. Live: list and tiles fingerprints (300 links: top, middle, bottom, back)
  identical; click-select in both modes survives a scroll.
- **US-1971** plan: FileSearch moves onto the host with two generic opt-ins (a row view may adopt the cell wrapper as
  its root; the host element may be placed under a given parent/anchor). **LogBodyView stays on its own pool
  (recorded partial migration):** `MeasuredRowGrid` has a different cell contract (kind-keyed `recycle(kind)`,
  `setReuseKey`, per-cell `measure` with an error fallback, cached initial heights); abstracting both engines is a
  separate host design, not an option on the RenderGrid host. **Decision sent with the implementation:** one row
  kind whose view switches between the file and line shapes internally, exactly as today's single cell record does,
  so a wrapper is adopted once and never re-adopted.
- `build-prod` passes after each task (run with `.vite/build` backed up and restored). Each code change made Vite
  reload the renderer windows (including the user's); pages restored themselves. The app was not restarted.

### 2026-11-14 — completion
- **Completion skills (Codex):** `/review` found missing-row guards in `FileSearchRowView`/`FileSearchView` (non-null
  assertions replaced by explicit checks; fixed); no other findings. `/document` updated `key-files.md`,
  `folder-structure.md`, `component-guide.md` and `model-view-pattern.md`. `/userdoc` changed nothing (the visible
  changes are a capitalised loading label and a header no production Autocomplete uses). No English catalog message
  changed; `npm run i18n:check` reports every pack complete (1672/1672).
- The completion run reverted the roadmap update made while it ran; it was re-applied before commit.
- **Line counts (HEAD → now, total / code):** `TreeModel.ts` 830 / 598 → 806 / 580; `TreeView.ts` 607 / 422 →
  437 / 298; `ListBoxModel.ts` 414 / 294 → 322 / 240; `ListBoxView.ts` 559 / 403 → 291 / 220;
  `TreeProviderViewImpl.ts` 511 / 429 → 520 / 447; `FileSearchView.ts` 388 / 349 → 271 / 243 (plus
  `FileSearchRowView.ts`, 129); `LinksListView.ts` 427 / 384 → 405 / 367; `LinksTilesView.ts` 592 / 543 → 581 / 532.
  New shared modules: `repaint-tracker.ts` (35), `pooled-row-host.ts` (294), `list-shell-arms.ts` (78).
- **Not verified live** (the user was working in the main window, so the app was not restarted): cold start, drag and
  drop in the trees and the link views (synthetic drag events do not start a Chromium drag), the loading arm text,
  and Settings/GitRefs/About trees beyond their unchanged fingerprints.
