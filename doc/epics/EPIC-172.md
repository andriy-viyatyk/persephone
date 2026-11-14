# EPIC-172: Refactoring Phase 6.7 part 4 — shared list filter and navigation, tree-provider view cleanups, DOM-prop helpers

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-second epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 4 of roadmap item
**6.7, Tree and UIKit**: findings **UIK-6** (the combobox and list family duplicates trait resolution, filtering and
keyboard navigation), **UIK-9** (tree-provider views hand-build Panel DOM, `…Impl` naming), **UIK-10** (React-era
leftovers) and **UIK-11** (DOM-attribute helpers and rest-prop blacklists) in
`doc/reviews/refactoring-2026-11/09-uikit.md`, plus the follow-up EPIC-171 recorded: `EditorsTreeView`,
`SettingsView`, `GitRefsView` and `AboutGuideBrowserView` signal tree repaints through fresh callback identities.

The code was checked on 2026-11-14, after EPIC-171. The findings hold, with drift:

- **UIK-6.** `runAccessor` is still copied in `ListBoxModel.ts:44`, `SelectModel.ts:101` and `TreeModel.ts:47`;
  `defaultMatch` in `SelectModel.ts:107` and `AutocompleteModel.ts:98`, `matches` in `MultiListBoxModel.ts:51`.
  The keyboard switches still diverge: ArrowUp with no active row lands on row 0 in Select (`SelectModel.ts:520`),
  ListBox, Tree and Menu, but on the last row in Autocomplete (`AutocompleteModel.ts:349`); PathInput wraps
  (`PathInputModel.ts:246-262`), RadioGroup and SegmentedControl wrap (ARIA radio pattern), the rest clamp. Page size
  is 9 in Select/Autocomplete, the visible row count in ListBox/Tree/Menu.
- **UIK-9.** `TreeProviderViewImpl.ts:208-243` and `CategoryViewImpl.ts:175` still hand-set `panel-root` /
  `data-component="panel"` and overwrite `data-type`; the `…Impl` names have 12 importing files; the
  `components/tree-provider/index.ts` barrel has 3 importers.
- **UIK-10 is partly done already.** `uikit/index.ts`, the one-line per-folder barrels (only `DataGrid` and `Menu`
  remain, both real surfaces), the registry `version` counters and the `language-icon-resolver.ts` mojibake are gone.
  Left: `PopoverProps.children` / optional `contentView` / the `IOwnedView & { mount() }` casts, the ten
  `TreeModel` DnD "compatibility delegates" (`TreeModel.ts:533-547`), and the stale archaeology comments.
- **UIK-11.** `setOrRemove`/`toggle` are still pasted into `AutocompleteView`, `ListBoxView`, `ListItemView`
  (as `setAttr`/`toggleAttr`), `MultiListBoxView`, `MultiSelectView` and `SelectView`; `cssLength` into
  `CollapsiblePanelStackView`, `InputView` (exported), `MultiListBoxView`, `MultiSelectView`, `ProgressBarView`,
  `SelectView` and `TextareaView`, next to the shared `dom-props.ts:115` one; 45 `eslint-disable no-unused-vars` in
  UIKit, mostly rest-prop blacklists.

## Goals

- **UIK-6 steps 1–2.** `resolveTraitedOne` beside `resolveTraited` in `core/traits/traits.ts`; the three
  `runAccessor` and three single-value copies deleted. `uikit/shared/list-filter.ts` (`matchLabel`,
  `filterParallel`) used by Select, Autocomplete and MultiListBox.
- **UIK-6 step 3.** `uikit/shared/list-navigation.ts`: a pure `nextActiveIndex(key, current, count, options)`
  used by ListBox, Tree, Select, Autocomplete, PathInput, Menu, RadioGroup and SegmentedControl. Each component
  keeps its own Enter/Escape/open semantics and states clamp or wrap explicitly at its call site.
- **UIK-6 step 4.** One small `ComboboxPopoverState` helper for the open/close/resized state Select, Autocomplete
  and MultiSelect each hand-write.
- **UIK-9 + UIK-10.** The tree-provider views build their regions with `createPanelElement`/`createTextElement`;
  renamed to `TreeProviderView` and `CategoryView`; identity aliases and the barrel deleted; `IMountableView` in
  `vanilla-view.ts`, `PopoverProps.children` deleted and `contentView` required; `TreeView` calls `model.dnd.*`
  directly; archaeology comments rewritten to state current invariants.
- **UIK-11.** `setOrRemoveAttr`, `toggleAttr` and one `cssLength` in `uikit/shared/dom-props.ts`; rest-prop
  blacklists replaced by a typed `splitProps(props, OWN_KEYS)` where a missing key is a type error.
- **Follow-up from EPIC-171.** The four app trees signal repaints explicitly, not through fresh callback identities.

## Decisions this epic acts on

- **Scope: six tasks.** UIK-6 (three tasks), UIK-9 + UIK-10 (one task: both are small, both touch the tree-provider
  views and Tree), UIK-11, and the EPIC-171 follow-up. **UIK-12** (components model generations, `ImperativeSplitter`,
  FileList → FileGrid) is M-sized, touches the page manager's reparenting avoidance and is unrelated to the list
  family, so it is **deferred to part 5**, the last 6.7 epic.
- **Navigation semantics (D9, accepted 2026-11-10: clamp everywhere, wrap only where wanted).**
  - Clamp: ListBox, Tree, Select, Autocomplete, Menu. Wrap: PathInput (as today) and RadioGroup/SegmentedControl
    (the WAI-ARIA radio-group pattern wraps; they are not lists). The choice is an explicit option at each call site.
    **No new public `wrap` prop**: no caller needs the other behaviour, and a prop nobody sets is speculative; the
    explicit per-component option satisfies D9's intent ("by choice, not by accident").
  - **No active row:** downward keys start before the first row, upward keys start at the first row (today's Select,
    ListBox, Tree and Menu rule). **Behaviour change (recorded):** in an open Autocomplete with no active row,
    ArrowUp/PageUp now land on the first row instead of the last (or last − 9). Chosen because four of five list
    controls already behave this way, so it is the smallest visible change.
  - **What stays per component:** how the popup opens and which row it seeds (Select seeds the selected row, as a
    native select does; Autocomplete seeds row 0 or the last row because it has no selection), Enter/Escape/Tab, page
    size (9 vs visible rows), and disabled-row skipping (ListBox, Tree, RadioGroup, SegmentedControl skip; the helper
    takes an optional predicate and reproduces each component's current fallback when no enabled row lies ahead).
    Tree's ArrowLeft/Right and Ctrl+A stay in `TreeKeyboardHandler`.
- **List filter.** `matchLabel` reproduces the current `contains`/`startsWith`/`off` semantics exactly (case folding
  included); the tree search keeps `tree-search-filter.ts` (word match, not label match) unless the planner shows the
  rules are identical.
- **`resolveTraitedOne`** lives in `core/traits/traits.ts` next to `resolveTraited` (the trait owner), not in UIKit.
- **Rename (UIK-9):** `TreeProviderViewImpl` → `TreeProviderView`, `CategoryViewImpl` → `CategoryView`, file names
  follow; the CSS files already carry those names. Every importer updated, no re-export shims. App `data-type`
  overrides become `data-name` (or an extra class) only after grepping `assets/guides`, `qa/`, CSS and automation for
  the old `data-type` values; a value something addresses is kept as `data-name`.
- **Tree repaint follow-up.** A tree that needs a repaint without a structural change passes an explicit signal (an
  optional `Tree` prop in the global repaint keys, the same shape as ListBox's `selectionSignal`) and stores its
  callbacks; the planner proves each of the four views repaints when its data changes (category chips and board
  update buttons in `EditorsTreeView`, Settings section state, git refs, About guides).
- **Behaviour is kept** except the recorded changes. Rendered DOM, CSS classes and every `data-name` stay identical
  (structural fingerprints before/after of a Select popup, an Autocomplete/PathInput popup, the Explorer tree, the
  Settings tree and a folder/category view). Keyboard flows are checked live per task.
- **Contracts that must not change:** the public props of UIKit components (types may get stricter only where a key
  list makes them so; a new optional prop is allowed for the tree signal), `api/types/*.d.ts`, the script API and
  facades, ai-vision paths and output, MCP `call`, `data-name`, persisted settings and expansion state,
  `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1). No board rule moves (2). God files only shrink (3): `TreeModel.ts`,
  `TreeProviderViewImpl.ts`, `SelectModel.ts`, `AutocompleteModel.ts` and every touched view; line counts recorded as
  total and code-only; **comments are never deleted to reach a count**. Plans name the owner of every moved rule (4).
  No `await import()` (5).
- **Order.** Wave 1 plans US-1973, US-1976 and US-1978 in parallel (different areas); implementations run one at a
  time. Wave 2 plans US-1974 and US-1977 against the landed code; wave 3 US-1975. A plan written before an earlier task
  landed is re-checked against the current code before implementation.
- **Live verification limits.** The user is using Persephone. Live checks run in a separate window opened and closed
  by the agent, on fixtures under `%TEMP%`; no page, dialog or window the agent did not open is touched, and the app is
  not restarted while other pages are open. `npm run build-prod` runs with `.vite/build` backed up and restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1973 | `resolveTraitedOne` and `uikit/shared/list-filter.ts` (UIK-6 steps 1–2) | Done |
| US-1974 | `uikit/shared/list-navigation.ts` and one clamp/wrap rule (UIK-6 step 3, D9) | Done |
| US-1975 | `ComboboxPopoverState` for Select, Autocomplete and MultiSelect (UIK-6 step 4) | Done (no change: decided against a helper) |
| US-1976 | Tree-provider views on Panel/Text, `…Impl` rename, React-era leftovers (UIK-9, UIK-10) | Done |
| US-1977 | `dom-props` attribute helpers and typed `splitProps` (UIK-11) | Done |
| US-1978 | Explicit repaint signal for the Editors, Settings, GitRefs and About trees (EPIC-171 follow-up) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts (total and code-only) before and
  after for every touched god file. For every exported symbol that moves, is renamed or is deleted, list its importers
  and update them (no re-export shims). Every `data-name` and `data-*` attribute in a touched view listed and shown
  preserved. No unit tests or harnesses. Comments describing surviving code move with it.
- **US-1973.** Each copy side by side with the shared function, proving identical results (including `undefined`
  accessors, non-string labels, case folding, the `off` mode). Every caller of the parallel filtered arrays.
- **US-1974.** A table: component × key (ArrowUp/Down, PageUp/Down, Home, End) × state (no active row, first, middle,
  last, disabled rows ahead) → today's result and the result after; every difference must be one the epic records.
- **US-1975.** The open/close/resize code of the three models side by side; what each sets on open and close
  (active index, query, resized flag, focus) and which parts differ on purpose.
- **US-1976.** The `data-type` grep result for every overridden value; the DOM before/after for the message panel,
  search panel and category footer/tile scope (only dead attributes may disappear); every `…Impl` importer; each
  rewritten comment quoted before/after.
- **US-1977.** The typed `splitProps` shape; for every blacklist replaced, the key list and proof that no own prop
  leaks to the DOM and no previously-forwarded attribute stops being forwarded.
- **US-1978.** For each of the four views, what data change must repaint which cell content today, and how the new
  signal covers it; callbacks become stored fields.

## Out of scope

- UIK-12: part 5.
- Roadmap item 2.4 moves.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-171. Findings re-checked against the code (see Overview). Codex weekly window had 20% left
  and the 5-hour window 79%; the policy pick was Luna. The user then asked for Terra/high on every planning run
  (they will reset the weekly limit when needed). The three wave-1 plans had already started on Luna; their correction
  rounds and all later planning runs use `--terra` (Terra/high). Implementation and completion stay on Luna.

### 2026-11-14 — wave 1 (US-1973, US-1978, US-1976)
- **US-1973** plan accepted (Codex verified the three default matchers are character-equivalent and the call-site
  differences are deliberate: Select bypasses a custom filter when closed or `off`, Autocomplete calls it in every
  mode, MultiListBox has none). Implementation notes: no new exports through the `core/traits` barrel (direct
  imports), `SelectModel.seedIndex` keeps its own loop. `resolveTraitedOne` takes an optional plain-value accessor
  so Tree keeps its rule (a plain `value` resolves through the items accessor, a wrapped one never falls back).
  `tree-search-filter.ts` (all-words match), `EditorsTreeView` (locale folding) and `SiteExtensionsTab`
  (multi-field) keep their own rules. Result: `ListBoxModel.ts` 322 / 240 → 307 / 227, `SelectModel.ts` 735 / 457 →
  706 / 433, `AutocompleteModel.ts` 393 / 270 → 382 / 260, `TreeModel.ts` 806 / 580 → 783 / 561; new
  `uikit/shared/list-filter.ts`. Live (test window): Select popup filter (case-insensitive contains, no-match,
  Escape) works; Explorer and Settings tree fingerprints identical at top, middle, bottom and back.
- **US-1978** plan accepted. Finding: today the Editors tree already repaints on every `pushProps()` because
  `getIconElement`, `renderTrailing` and `getDragData` are all fresh global keys; Settings' `isSelected` is a global
  key too, so its selected-content signal reproduces today's repaint exactly. Editors gets a string projection of
  the displayed category chip and update button (built in `pushProps()` only, never on hover); GitRefs signals
  `currentBranch`; About needs no signal.
- **US-1978 result:** `Tree` gains the optional `repaintSignal` prop (global repaint key, kept out of DOM rest props);
  the four views store their callbacks. `EditorsTreeView.ts` 316 / 288 → 356 / 321, `SettingsView.ts` 448 / 388 →
  454 / 392, `AboutGuideBrowserView.ts` 426 / 381 → 431 / 384; `TreeModel.ts` unchanged in size. **Behaviour change
  (recorded):** hovering or an unchanged refresh no longer repaints every row of these trees. Live: Settings tree
  fingerprints identical, click-select repaints the selection (Theme → Voice Typing → Editors → Theme); Tools hub
  Editors tree renders its category chips and hover changes one cell only. Not exercised live: a category/update
  change repainting the chip (it needs a real settings change) — manual check.

### 2026-11-14 — wave 2 plans (US-1974, US-1975, US-1977) and US-1976 corrections
- **US-1976 corrections sent:** the comment-rewrite tables quoted a dozen comments twice with different
  replacements (merged into one row per comment), and several rewrites dropped facts about current code
  (`GridInteractions.focusRoot` declining focus, why the grid cannot own its tooltip, `tooltipRegistry.nextId()`'s
  shape, `SelectModel.commitSelection` focusing inline): rule sent — remove only the history clause. **Decision:** the
  Category tile scope and footer keep the `data-component="panel"` that `createPanelElement` writes (post-editing a
  primitive's output is the hand-imitation UIK-9 removes); footer Panel options only where the resolved value equals
  today's CSS (align, dark background, border-top); gap and padding stay in `CategoryView.css`. Codex checked the two
  CSS selectors on `[data-type="panel"]` and found neither matches these nodes. The review's "No content" literal was
  already translated (`mneme.noContent`), and the barrel had five importers, not three.
- **US-1974 corrections sent:** the document had lost every non-ASCII symbol (about 40 literal `?`); rewritten in
  ASCII. **Decision:** an open Select with an empty list no longer writes `activeIndex = max(0, (activeIndex ?? 0) -
  step)` on ArrowUp/PageUp (an index into an empty list); recorded as a second behaviour difference. The helper's
  options are fixed by the plan (`wrap`, `page`, `pageStart: "zero" | "before-first"`, `pageFallback: "none" |
  "opposite-end"`, `isEnabled`), so ListBox/Tree keep their page start and reverse fallback. Kept apart on purpose:
  `BrowserUrlBarModel` (Up returns to the typed URL at -1), `ClipboardSecondaryView` (moves the selection and opens
  it), `EditorCategoriesPopoverView` (DOM roving focus) and `ToolbarView` (nested roving hosts).
- **US-1975 decision: no helper.** The planner compared the three models: they share only `s.open = true/false`;
  Select and MultiSelect also reset `popoverResized`; Autocomplete has no resize state and seeds its active row
  differently. A shared mutator would move two assignments and add imports and per-component extra writes, and an
  owning class would add a second state channel. I checked `openInto`/`closeInto` in all three and agree; UIK-6 step
  4 was marked optional. The task closes with no code change.
- **US-1977 decisions sent:** the planner stopped on two existing leaks. Label forwarded `preWrap`, `truncate`,
  `align` and `hoverUnderline` to the `<label>` as attributes (never applied to its Text; no CSS selects them) — they
  become own keys and the dead attributes disappear (recorded). SplitButton's `onOpenMenu` was missing from its
  blacklist, so `applyRestProps` installed a root `openmenu` listener nothing dispatches — it becomes an own key
  (recorded fix). The combobox `aria-label`/`aria-labelledby`, Popover `data-type` and Toolbar `aria-label` stay
  forwarded native attributes.

### 2026-11-14 — implementations (US-1976, US-1974)
- **US-1976 result:** tree-provider message/search panels and the Category tile scope/footer are built with
  `createPanelElement`/`createTextElement`; `TreeProviderViewImpl` → `TreeProviderView`, `CategoryViewImpl` →
  `CategoryView` (12 importers updated, the `components/tree-provider/index.ts` barrel and the identity aliases
  deleted); `IMountableView` in `vanilla-view.ts` used by Popover, `CategoryItemsViewHandle` and `DialogContainer`;
  `PopoverProps.children` deleted and `contentView` required (19 call sites already passed one); `TreeView` calls
  `model.dnd.*` (the eleven delegates, including `isDndEnabled`, deleted). About 35 archaeology comments rewritten by
  removing only the history clause. `TreeModel.ts` 783 / 561 → 766 / 548, `PopoverView.ts` 464 / 378 → 455 / 370,
  `TreeProviderView.ts` 520 / 447 → 518 / 445, `CategoryView.ts` 478 / 423 → 476 / 421. **DOM change (recorded):** the
  Category footer is `data-type="panel"` with `data-component="panel"` and `data-bg="dark"` instead of
  `data-type="category-footer"` plus four dead `data-align`/`data-gap`/`data-padding-x`/`data-background`; the
  tree-provider message and search panels are `data-type="panel"` with an app class (their `data-name`s unchanged).
  Live: Category view fingerprints identical except that footer line at top, middle, bottom and back; footer computed
  style identical (flex row, centre, 4px gap and padding, background, border-top, 29px); Explorer fingerprints
  identical; Ctrl+F search panel (2px padding, border-top, 29px) opens and Escape closes it; Select popup filter and
  Escape; tree click, Ctrl+click and ArrowDown. Not verifiable with synthetic events: tree drag and drop (manual).
- **US-1974 result:** `uikit/shared/list-navigation.ts` (`nextActiveIndex`) used by ListBox, Tree, Select,
  Autocomplete, PathInput, Menu, RadioGroup and SegmentedControl; each states `wrap` explicitly (PathInput, RadioGroup,
  SegmentedControl wrap; the rest clamp). Live, before/after in the test window: a 60-item Select popup driven through
  17 keys (Down, PageDown, End, PageUp, Home, Up, reopen with Up) and the Explorer tree through 13 keys (Home, Down,
  PageDown ×2, End, PageUp, Up, End, PageDown at the end) give identical active rows. Not exercised live: Autocomplete
  (no production instance in the test window; the recorded ArrowUp-from-no-row change), PathInput wrap, Menu,
  RadioGroup/SegmentedControl — manual checks.
- **US-1977 result:** `setOrRemoveAttr`, `toggleAttr` and one `cssLength` live in `uikit/shared/dom-props.ts` with
  `splitProps(props, OWN_KEYS)` and a `CompleteKeys<Own, Keys>` check, so a missing own key is a compile error (the
  implementer proved it with a temporary probe); 32 UIKit views and models declare an `…OwnProps` interface and a
  checked key tuple instead of a destructuring blacklist. Select and PathInput props moved to `SelectProps.ts` and
  `PathInputProps.ts` (`SelectModel.ts` 699 → 632, `PathInputModel.ts` 312 → 265). **Fixes I made after the run:**
  the implementation's PowerShell edits had glued 46 files' `import …;export interface …` onto one line and left
  `import {a,b}` imports unspaced (reformatted by a script); it had added re-export shims in `SelectModel.ts` and
  `PathInputModel.ts` (removed; `SelectView`, `PathInputView` and `TagsInputView` import the props modules directly);
  and it had named the tuples `checkedSELECTOwnKeys`-style (renamed `checkedOwnKeys`). **Recorded changes:** Label
  no longer emits `preWrap`/`truncate`/`align`/`hoverUnderline` as dead DOM attributes; SplitButton no longer installs
  a root `openmenu` listener. Live: Settings panels (1,668-line fingerprint), the MCP log page, a Select popup, the
  Category view and the Explorer give identical fingerprints at top, middle, bottom and back (apart from generated
  `data-id` counters after the renderer reload, live status text and my own selection clicks); the Select and tree
  keyboard walks are identical to the pre-epic baseline.

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` found nothing. `/document` updated `key-files.md`,
  `folder-structure.md`, `secondary-views.md`, `component-guide.md`, `model-view-pattern.md`, `coding-style.md`
  and `uikit/CLAUDE.md` (the Popover `contentView` rule now names the required `IMountableView`). `/userdoc` changed
  nothing. No English catalog message changed; `npm run i18n:check` reports every pack complete (1672/1672).
- **Not verified live** (the user was working in the main window, so the app was not restarted and live checks ran
  in a separate test window): cold start; tree drag and drop (synthetic drags do not start); Autocomplete,
  PathInput, Menu, RadioGroup and SegmentedControl keyboard navigation; a category or board-update change repainting
  the Editors tree chip.
- **Remaining 6.7 work:** UIK-12 (part 5).
