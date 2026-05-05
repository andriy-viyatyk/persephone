# US-487: UIKit model-view migrations — Select, Menu, Popover, PathInput

**Epic:** EPIC-025 (Phase 4 — UIKit primitive cleanup)
**Status:** Planned
**Predecessor:** US-484 (ListBox model-view migration — established the pattern in UIKit)
**Reference:** [/doc/standards/model-view-pattern.md](../../standards/model-view-pattern.md), [/src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md) Rule 8

---

## Goal

Migrate the four UIKit components that exceed Rule 8 thresholds to the model-view architecture, in four self-contained phases. Each phase delivers one fully-migrated component (model + pure view) with **no behavior change** for consumers.

After this task:
- `Select`, `Menu`, `Popover`, `PathInput` each have a `*Model.ts` co-located with the View
- The view files contain no `useState`/`useCallback`/`useEffect` for component logic (only the few hooks that *must* live in React — `useId`, `useImperativeHandle`, `useFloating`, `useMergeRefs`)
- Storybook stories continue to pass smoke tests; downstream consumers need no changes

---

## Background

### Why these four

A survey against Rule 8 thresholds (>4–5 useState, >3 useCallback, multiple overlapping effects, complex coordination):

| Component | useState | useCallback | useEffect | useMemo | useRef | Lines | Rule 8 verdict |
|-----------|----------|-------------|-----------|---------|--------|-------|----------------|
| **Select** | 5 | **12** | 2 | 4 | 4 | 390 | Above — by a wide margin |
| **Menu** | 5 | 0 | 5 | 3 | 4 | 387 | Above — overlapping effects |
| **PathInput** | 3 | **7** | 5 | 2 | 5 | 338 | Above — coordinating refs across handlers |
| **Popover** | 2 | 3 | 5 | 3 | 4 | 333 | Above — 5 effects + drag closure |

Tooltip (5 cb / 2 eff / 184 lines) and Dialog (3 cb / 0 eff / 181 lines) are below the bar today and are explicitly **out of scope**.

### Pattern reference

`ListBoxModel.ts` (US-484) is the canonical UIKit model-view example and was the first migration into UIKit. It uses:
- `init()` to register `this.effect(...)` callbacks (no `useEffect` in the View)
- `this.memo(fn, deps)` for derived values (no `useMemo` in the View)
- A class field for refs (`gridRef: RenderGridModel | null = null`) plus a `setGridRef` setter passed through `ref={model.setGridRef}`
- A `setReactId(id)` method called from the View with `useId()` — because `useId()` must run in React
- `useImperativeHandle(ref, () => ({...}))` in the View, delegating to model methods
- The `as unknown as Model<T>` cast on the class passed to `useComponentModel` to satisfy TypeScript's generic-class instantiation rule

`TreeView.model.ts` and `RenderGridModel.ts` are additional references for non-UIKit models.

### Hooks that *must* stay in the View

The model is a plain class — it cannot call React hooks. Hooks that **must** remain in the View, with their results passed into the model via setter methods:

- `useId()` — for stable DOM ids (already pattern in ListBox)
- `useImperativeHandle()` — for parent ref API (already pattern in ListBox)
- `useFloating()` from @floating-ui/react — Popover, Tooltip
- `useMergeRefs()` from @floating-ui/react — Popover
- `useComponentModel()` itself — entry point

Pattern: View calls the hook, passes the resulting value (or setter) into the model.

### Consumer surface (blast radius)

| Component | Consumers (outside UIKit) | Risk |
|-----------|---------------------------|------|
| **Select** | Only Storybook (US-472 not yet adopted in any per-screen migration) | Low |
| **Menu / WithMenu** | `ui/tabs/PageTab.tsx`, `ui/tabs/PageTabs.tsx` (right-click context menus on tabs) | Medium |
| **Popover** | `editors/browser/BrowserDownloadsPopup.tsx`, `editors/browser/UrlSuggestionsDropdown.tsx`, plus internal use by Menu / Select / PathInput / Tooltip | **High** — internal use |
| **PathInput** | `editors/link-editor/EditLinkDialog.tsx`, `editors/notebook/{ExpandedNoteView,NoteItemView}.tsx`, `uikit/TagsInput/TagsInput.tsx` | Medium |

### Phase ordering rationale

Independent of Rule 8 priority, the order that minimizes risk:

1. **PathInput first** — completely independent of other UIKit primitives' internals; smallest of the four; warm-up after ListBox.
2. **Menu second** — uses Popover as a child but its own internals are independent; tab context menus exercise it well.
3. **Select third** — depends on ListBox (already migrated) and Popover (still old at this point — fine, it's a black box from Select's view); benefits from any patterns refined in Menu.
4. **Popover last** — highest blast radius (every overlay component is a consumer). By now the team has migrated three components and knows the patterns cold; Popover's `useFloating` boundary is the only remaining novelty.

Each phase is independently shippable. The user verifies the migrated component before the next phase starts.

---

## Implementation plan

### Phase 1 — Migrate `PathInput`

**Goal:** Move `PathInput.tsx` logic into a new `PathInputModel.ts`. The View becomes a pure render function.

**State to lift to model:**
- `open: boolean`
- `activeIndex: number | null`

**Refs to lift (as class fields with setters):**
- `inputRef: HTMLInputElement | null`
- `rowsRef: HTMLDivElement[]` (still an array — model holds it; setter assigns by index)
- `selectionMadeRef: boolean` (plain boolean field — was a ref to coordinate blur vs. selection)
- `escapeCancelledRef: boolean` (plain boolean field — was a ref for Escape commit suppression)

**Memos to convert:**
- `suggestions = this.memo(() => getPathSuggestions(...), () => [this.props.value, this.props.paths, this.props.separator, this.props.maxDepth])`

**Effects to register in `init()`:**
1. **Reset highlight when suggestions change** — deps `[this.suggestions.value]`, body `this.state.update(s => { s.activeIndex = null })`
2. **Scroll active row into view** — deps `[this.state.get().activeIndex]`, body `this.rowsRef[idx]?.scrollIntoView({ block: 'nearest' })`
3. **autoFocus place caret at end on mount** — deps `[]`, body sets selection range

**Handlers to migrate (no `useCallback` needed):**
`selectSuggestion`, `onInputChange`, `onInputFocus`, `handleBlur`, `onInputKeyDown`

**View shape:**
```tsx
function PathInputView(props, ref) {
    const model = useComponentModel(props, PathInputModel, defaultPathInputState);
    useImperativeHandle(ref, () => ({/* pass-through if needed */}), [model]);
    const { open, activeIndex } = model.state.use(s => ({ open: s.open, activeIndex: s.activeIndex }));
    const suggestions = model.suggestions.value;
    return ( /* JSX with handler bindings to model methods */ );
}
```

**Files:**
- New: `src/renderer/uikit/PathInput/PathInputModel.ts`
- Modified: `src/renderer/uikit/PathInput/PathInput.tsx` (rewritten as pure View)

**Smoke tests:**
- Storybook → "PathInput" story: type into input, see suggestions; ArrowDown / ArrowUp navigate; Tab / Enter select; folder selection appends separator; leaf selection commits; Escape cancels
- `EditLinkDialog`: category path field still autocompletes
- `ExpandedNoteView` / `NoteItemView`: notebook category path edit still works
- `TagsInput`: when used as a tag-with-paths source, autocomplete still works

---

### Phase 2 — Migrate `Menu`

**Goal:** Move `Menu.tsx` logic into a new `MenuModel.ts`. Sub-menus continue to render recursively (each `Menu` instance gets its own model — same pattern as today).

**State to lift to model:**
- `search: string`
- `hoveredId: string | null`
- `subMenuItem: MenuItem | null`
- `subMenuAnchor: Element | null`

**Refs to lift:**
- `listRef: HTMLDivElement | null`
- `searchInputRef: HTMLInputElement | null`
- `subTimerRef: number | null` (window timer id)

**Memos to convert:**
- `hasAnyIcon = this.memo(() => items.some(i => Boolean(i.icon)), () => [this.props.items])`
- `prepared = this.memo(() => buildPrepared(...), () => [this.props.items, this.state.get().search, this.showSearch])`

**Effects to register in `init()`:**
1. **Reset state when `open` toggles or `items` change; init hovered to selected** — deps `[this.props.open, this.props.items]`
2. **Clear sub-timer on unmount** — no deps, returns cleanup
3. **Auto-focus appropriate element on open** — deps `[this.props.open, this.showSearch]`
4. **Scroll hovered row into view on `hoveredId` change** — deps `[this.state.get().hoveredId]`

**Handlers to migrate:**
`scheduleSubMenu`, `clearSubTimer`, `activate`, `onSubMenuClose`, `onKeyDown`, `onMouseEnter`/`onMouseLeave`/`onClick` for rows

**Computed:**
- `get showSearch()` — `this.props.items.length > SEARCH_THRESHOLD`

**Files:**
- New: `src/renderer/uikit/Menu/MenuModel.ts`
- Modified: `src/renderer/uikit/Menu/Menu.tsx` (pure View)

**Smoke tests:**
- Storybook → Menu / WithMenu stories: open, hover, sub-menu opens after delay, keyboard nav, search filter (when items > 20), Enter activates, Escape closes
- `PageTab` right-click context menu: opens, items present, sub-menus
- `BrowserEditorView` link/image context menus
- `GraphContextMenu`

**Recursion note:** `Menu` recursively renders a child `Menu` for sub-menus. Each child `Menu` mounts its own `MenuModel` via `useComponentModel` — independent lifecycles. No shared state needed.

---

### Phase 3 — Migrate `Select`

**Goal:** Move `Select.tsx` logic into a new `SelectModel.ts`. **Inline the `useSelectItems` hook into the model** (its state and effects become model state and `this.effect(...)` calls).

**State to lift to model:**
- `open: boolean`
- `searchText: string`
- `activeIndex: number | null`
- `popoverResized: boolean`
- (Inlined from `useSelectItems`) `loadedItems: IListBoxItem[]`, `loadedSources: T[]`, `itemsLoading: boolean`, `itemsLoaded: boolean`, `itemsError: unknown`

**Refs to lift:**
- `inputRef: HTMLInputElement | null`
- `rootRef: HTMLDivElement | null`

**Memos to convert:**
- `selectedResolved` — `() => [this.props.value]`
- `filtered` — combined `{filteredItems, filteredSources}` — deps `[this.state.loadedItems, this.state.loadedSources, this.state.open, this.state.searchText, this.props.filterMode, this.props.filter]`
- `displayText` — deps `[this.state.open, this.state.searchText, this.selectedResolved.value]`

**Effects to register in `init()`:**
1. **Sync items source — reset cache when `props.items` reference changes** — deps `[this.props.items]`
2. **Load async items on first `open=true`** — deps `[this.props.items, this.state.open, this.state.itemsLoaded]`; cleanup sets a `live` flag
3. **Reset search/active/resized when popover closes** — deps `[this.state.open]`

**Handlers to migrate (replacing 12 `useCallback`s with stable methods):**
`tryOpen`, `onInputChange`, `onInputFocus`, `onInputClick`, `onChevronMouseDown`, `onChevronClick`, `commitSelection`, `onListChange`, `onInputKeyDown`, `setInputRef` (still wired via the View's `ref` arg)

**`useId` boundary:**
- View calls `useId()` and passes via `model.setReactId(id)`; model derives `selectId` and `listboxId` from it

**`forwardRef` boundary:**
- View takes `ref: React.ForwardedRef<HTMLInputElement>`. The model's `setInputRef` writes the DOM node both to `model.inputRef` and forwards to the user's ref (same pattern as `ListBox.scrollToIndex` exposure).

**Files:**
- New: `src/renderer/uikit/Select/SelectModel.ts`
- Modified: `src/renderer/uikit/Select/Select.tsx` (pure View)
- **Deleted:** `src/renderer/uikit/Select/useSelectItems.ts` (logic absorbed into model). Re-export `ItemsSource`/`SelectItemsResult` types from `Select.tsx` so the public API in `uikit/index.ts` is unchanged.

**Smoke tests:**
- Storybook → all Select toggles: sync items, async loader, custom filter, predicate selection, resizable popover, custom row, keyboard nav (Arrow/Page/Home/End/Enter/Escape)
- Verify `aria-expanded` / `aria-controls` / `aria-haspopup` still set
- Verify "load on first open" semantics for `() => Promise<...>` source

---

### Phase 4 — Migrate `Popover`

**Goal:** Move `Popover.tsx` logic into a new `PopoverModel.ts`. The `useFloating` / `useMergeRefs` hooks remain in the View; the model owns everything else.

**State to lift to model:**
- `manualSize: { width, height } | null`

**Refs to lift:**
- `internalRef: HTMLDivElement | null`
- `initialSizeRef: { width, height } | null` (drag baseline)
- `manualSizeRef` — replaced by reading `this.state.get().manualSize` directly inside the floating-ui `size()` middleware factory (which is built in a memo)

**Memos to convert:**
- `placeRef` — `() => [this.props.elementRef, this.props.x, this.props.y]`
- `middleware` — `() => [this.props.offset, this.props.matchAnchorWidth]` — middleware factory body reads `this.state.get().manualSize` to keep the matchAnchorWidth-vs-manual-size precedence

**Effects to register in `init()`:**
1. **Tell floating-ui's `refs.setPositionReference` when `placeRef` changes** — deps `[this.placeRef.value]`. The View hands `refs` to the model after `useFloating` runs (see "boundary" below).
2. **Reset manual size on close** — deps `[this.props.open]`
3. **Document-level click-outside + Escape listeners** — deps `[this.props.open, this.props.outsideClickIgnoreSelector]`; cleanup removes listeners

**Handlers to migrate:**
`onOpenChange` (passed to `useFloating`), `onHandlePointerDown` (drag handler — uses `internalRef`, captures startX/startY/initial in local scope, attaches pointer listeners directly on the DOM node)

**`useFloating` boundary (the unique design point of this phase):**
- View calls `useFloating(...)` with `placement`, `middleware`, `strategy`, `whileElementsMounted`, and a stable `onOpenChange` (delegating to `model.onOpenChange`)
- View passes `refs`, `floatingStyles`, `actualPlacement` into the model via setters (e.g. `model.setFloating(refs, floatingStyles, actualPlacement)`), called every render
- The model uses `this.refs` to call `setPositionReference` from inside an effect
- The model's middleware factory `this.middleware.value` is read by the View and passed to `useFloating`

**`useMergeRefs` boundary:**
- View calls `useMergeRefs([model.refs.setFloating, ref, model.setInternalRef])` and applies the result to `<Root ref=...>`

**Files:**
- New: `src/renderer/uikit/Popover/PopoverModel.ts`
- Modified: `src/renderer/uikit/Popover/Popover.tsx` (pure View, plus the `useFloating`/`useMergeRefs` wiring)

**Smoke tests:**
- Storybook → Popover stories (basic, resizable, matchAnchorWidth, scroll=false)
- Storybook → Menu/Select/PathInput/Tooltip — all use Popover internally; nothing should regress
- `BrowserDownloadsPopup`: popup opens/closes, click-outside dismisses
- `UrlSuggestionsDropdown`: dropdown opens/closes, suggestions clickable, outside click in URL bar still works (the `outsideClickIgnoreSelector` integration)
- Drag-resize: handle visible when `resizable`, drag grows the popover, size resets on close

---

## Concerns / Open questions

### 1. Interpretation: "one task with four phases" vs. "four separate tasks"

Read the user message as: **one umbrella US-487 with four phases**, since each migration is small and uniform, and the scope is shared (`Rule 8` migrations). If you'd prefer four standalone tasks (US-487 / US-488 / US-489 / US-490), I'll split. Single-task with phases keeps the dashboard tidy.

### 2. `useFloating` lives in the View, not the model

`useFloating` is a React hook — cannot be called from a class. The Popover migration is the **only** one where the model doesn't fully own the floating logic. The boundary is documented in Phase 4 above (View calls `useFloating`, passes the result into the model via a setter). Tooltip would have the same constraint if migrated; it's deliberately out of scope here.

### 3. `useSelectItems` becomes part of `SelectModel`

The standard says "all logic lives in the model." Inlining `useSelectItems` is consistent. **Open question:** is `useSelectItems` valuable on its own outside Select (a future MultiSelect, perhaps)? If yes, we could keep it as a hook and call it in the Select View, then push results into the model — but that's a model-view boundary leak. Default: inline it.

### 4. `selectionMadeRef` and `escapeCancelledRef` (PathInput) become plain class fields, not state

These flags are used to coordinate blur vs. selection. They are NOT part of the rendered state — flipping them must not trigger a re-render. They become plain instance fields (`selectionMade: boolean = false`), not entries in the `TComponentState`. Same applies to `subTimerRef` (Menu) and `initialSizeRef` (Popover).

### 5. Drag handler closures (Popover)

`onHandlePointerDown` captures `startX`, `startY`, `startRect`, `initial` via closure for the duration of one drag. In the model, this becomes a method that creates local consts in its body — same closure semantics; no change. Only the listener-attachment to `internalRef` moves to the model method.

### 6. Effect deps that read `this.props` and `this.state.get()`

Confirmed working in `ListBoxModel`: `setPropsInternal()` reassigns `this.props`, then calls `_evaluateEffects()`, so a deps factory like `() => [this.props.activeIndex]` reads the latest value. State-reading deps like `() => [this.state.get().searchText]` — note `state.get()` returns the current state object, so deps are by-reference; this works because `update()` produces a new object each call.

### 7. Stable handler identity vs. Storybook re-renders

Model methods have stable identity across renders. Storybook re-renders on prop edits — verified in ListBox migration that this is fine (no stale-closure bugs).

### 8. `forwardRef` + generics + ref to imperative API

Three of the four (Select uses input ref, Popover uses div ref, PathInput uses input ref) use `forwardRef`. None expose an imperative API today, so `useImperativeHandle` is not strictly needed. We pass through to the underlying DOM node via the model's `setInputRef` / `setInternalRef`. Same `forwardRef + cast` shape as ListBox.

### 9. **No public API changes**

This is a refactor, not a feature task. Public prop types and exported types are unchanged. `uikit/index.ts` exports stay byte-for-byte identical. Storybook prop tables don't shift.

### 10. ESLint `react-hooks/exhaustive-deps`

The existing components have no eslint-disable comments on deps. The migration removes `useCallback` entirely (no deps) and folds `useEffect` into model effects (no deps lint rule applies). Net lint count goes down.

### 11. Test approach — manual smoke per phase

There is no component test suite for UIKit today. Each phase ends with a manual smoke pass per the per-phase test list. The user runs these and gives a "tested OK" before the next phase starts.

### 12. Per-phase commits

Each phase is one commit so that bisect granularity stays at the per-component level. Don't bundle phases into one commit.

### 13. Can a phase be skipped or deferred?

Yes. Phases are independent. If review of Phase 1 reveals a pattern flaw, Phase 2 can wait while we revisit Rule 8. If priorities shift, individual phases can be moved to a later sprint without blocking the rest of EPIC-025.

### 14. Do downstream tasks (US-472 Select adoption, US-481 Menu in PageTabs) need to wait?

No. They're already adopting these components today; the migration is internal-only. We coordinate by ordering: Phase 3 (Select) goes after the Storybook is solid; Phase 2 (Menu) likewise. If a per-screen migration is in flight on the same component, finish that first to avoid merge conflicts.

### 15. Bundle size

Adding `*Model.ts` files adds modest source weight; runtime bundle should be neutral or slightly smaller (no `useCallback` wrappers, fewer closures created per render). Not a concern; not measuring.

### 16. What if Tooltip drifts above the threshold during this work?

It won't — Tooltip is not touched. If a future feature (e.g. controlled `open`) crosses the line, file a follow-up US-XXX rather than expanding US-487.

---

## Acceptance criteria

### Phase 1 — PathInput
1. `src/renderer/uikit/PathInput/PathInputModel.ts` exists; extends `TComponentModel<PathInputState, PathInputProps>`
2. `PathInput.tsx` View contains zero `useState`, zero `useCallback`, zero `useEffect` for component logic (only `useComponentModel`, optional `useImperativeHandle`)
3. Storybook PathInput story: all toggles work as before
4. `EditLinkDialog`, `ExpandedNoteView`, `NoteItemView`, `TagsInput` smoke-tested by user — no regressions

### Phase 2 — Menu
5. `src/renderer/uikit/Menu/MenuModel.ts` exists; extends `TComponentModel<MenuState, MenuProps>`
6. `Menu.tsx` View contains zero `useState`/`useCallback`/`useEffect` for component logic
7. Storybook Menu / WithMenu stories: open, hover, sub-menu, search, keyboard nav, Escape — all work
8. `PageTab` / `PageTabs` right-click context menus: smoke-tested by user — no regressions
9. Recursive sub-menu rendering still works; submenu has independent lifecycle

### Phase 3 — Select
10. `src/renderer/uikit/Select/SelectModel.ts` exists; extends `TComponentModel<SelectState, SelectProps<T>>`
11. `useSelectItems.ts` is deleted; its logic lives in `SelectModel`; `ItemsSource` / `SelectItemsResult` types re-exported from `Select.tsx`
12. `Select.tsx` View contains zero `useState`/`useCallback`/`useEffect` for component logic (uses `useId` and `forwardRef`)
13. Storybook Select stories: sync items, async items, lazy items, filter modes, custom filter, custom row, keyboard nav, resizable popover, predicate selection — all work
14. `uikit/index.ts` exports unchanged byte-for-byte (verified by `git diff uikit/index.ts` after Phase 3 = empty)

### Phase 4 — Popover
15. `src/renderer/uikit/Popover/PopoverModel.ts` exists; extends `TComponentModel<PopoverState, PopoverProps>`
16. `Popover.tsx` View contains `useFloating` and `useMergeRefs` (these *must* remain in the View) but zero `useState`/`useCallback`/`useEffect` for component logic
17. Storybook Popover stories + every component that uses Popover internally (Menu, Select, PathInput, Tooltip) — all work
18. `BrowserDownloadsPopup`, `UrlSuggestionsDropdown`: smoke-tested by user — no regressions
19. Drag-resize: handle visible when `resizable`, drag grows popover, manual size persists for the open session, resets on close

### Cross-phase
20. After all four phases: every UIKit component above Rule 8 thresholds has been migrated; the only complex View hooks remaining in UIKit are the unavoidable React hooks (`useId`, `useFloating`, `useMergeRefs`, `useImperativeHandle`)
21. No public API changes — `git diff uikit/index.ts` is empty
22. ESLint passes with zero new warnings

---

## Files changed (estimate)

**New:**
- `src/renderer/uikit/PathInput/PathInputModel.ts`
- `src/renderer/uikit/Menu/MenuModel.ts`
- `src/renderer/uikit/Select/SelectModel.ts`
- `src/renderer/uikit/Popover/PopoverModel.ts`

**Modified:**
- `src/renderer/uikit/PathInput/PathInput.tsx`
- `src/renderer/uikit/Menu/Menu.tsx`
- `src/renderer/uikit/Select/Select.tsx`
- `src/renderer/uikit/Popover/Popover.tsx`
- `src/renderer/uikit/Select/index.ts` (re-export `ItemsSource` / `SelectItemsResult` from `Select.tsx` once `useSelectItems.ts` is deleted)

**Deleted:**
- `src/renderer/uikit/Select/useSelectItems.ts`

**Dashboard:**
- `doc/active-work.md` — checkbox flip per phase as user confirms each phase
