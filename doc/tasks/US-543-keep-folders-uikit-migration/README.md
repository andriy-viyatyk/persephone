# US-543: KEEP folders — UIKit migration of legacy primitive consumers

## Status

**Implemented — awaiting user testing + epic-close review.** Part
of [EPIC-025](../../epics/EPIC-025.md) Phase 4 — per-screen
migration. **Unblocks** [US-532](../US-532-legacy-components-removal/README.md)
deletion of `components/basic/` and `components/overlay/`.

### Implementation summary

- **Type-only flips (Step 1):**
  - `tree-provider/CategoryViewModel.tsx:3` — `MenuItem` import path
    `../overlay/PopupMenu` → `../../uikit/Menu`.
  - `tree-provider/TreeProviderViewModel.tsx:5` — same flip.
  - Both type re-exports point at `api/types/events`, so the swap is
    fully shape-compatible (verified by grep).
- **FileSearch.tsx (Step 2):**
  - Imports flipped: `TextField`/`Button` from `../basic/*` →
    `Input`/`IconButton` from `../../uikit/*`.
  - Main search row uses `<Input ... tone="accent">` for the blue
    text color; toggle-filter `<IconButton size="sm" icon=…>`
    replaces the legacy `<Button type="icon" size="small">` chevron.
  - Filter rows (include / exclude patterns) flipped to `<Input>`;
    they stay on default tone.
  - `FileSearchRoot` styled block: `.text-field { … color … }`
    override dropped entirely; selector switched to
    `[data-type="input"]` keeping only the `flex: "1 1 auto"`
    layout claim.
- **CategoryView.tsx (Step 3):**
  - Imports flipped same way.
  - Toolbar search `<Input>` uses `endSlot` (single ReactNode,
    conditionally rendered when `searchText` is non-empty) in place
    of the legacy `endButtons` array.
  - View-mode `<IconButton icon={…} size="sm">` replaces the legacy
    `<Button type="icon" size="small">` toggle.
- **Verification:**
  - Repo-wide grep
    `from "\.\./(basic|form|layout|overlay|TreeView)/` inside
    `src/renderer/components/` — zero matches outside the legacy
    folders themselves (which delete wholesale via US-532).
  - `npx tsc --noEmit` — 20 errors total, all pre-existing in
    unrelated files (`automation/commands.ts`, `VideoPlayerEditor.tsx`,
    `WorkerRunner.ts`, `PageTab.tsx`). Baseline unchanged; zero
    errors mention the four migrated files.
  - `npx eslint` on the four touched files — 0 errors, 8 warnings.
    All warnings pre-existing (`useState` unused import,
    non-null assertion, six `any` types in catch blocks); baseline
    unchanged.

## Goal

Migrate the four files inside the **KEEP** folders
(`components/file-search/` and `components/tree-provider/`) that
still import from the soon-to-be-deleted legacy primitive folders
(`components/basic/` and `components/overlay/`). After this task,
the KEEP folders are entirely free of legacy-primitive imports
and US-532 can delete the primitive folders.

This task ALSO realises the architectural contract documented for
`components/` in US-532 Background — that `components/` becomes
the home for **persephone-coupled, UIKit-consuming** components.
The four files migrated here are exactly the lingering legacy
consumers that block that contract from being true.

## Background

### Why this task exists

US-532's planning grep (`from "[^"]*components/(basic|form|layout|overlay|TreeView)`)
caught zero matches because the KEEP folders use **relative
imports** like `../basic/TextField` and `../overlay/PopupMenu`,
which don't contain `components/` in the path. The mistake was
caught when the US-532 implementation attempt deleted the
primitive folders and `npx tsc --noEmit` surfaced the broken
relative imports. US-532's deletions were rolled back; this task
clears the obstacle properly.

### The four broken files

| File | Imports | Difficulty |
|---|---|---|
| `tree-provider/TreeProviderViewModel.tsx` | `type { MenuItem }` from `../overlay/PopupMenu` | TRIVIAL — type-only swap |
| `tree-provider/CategoryViewModel.tsx` | `type { MenuItem }` from `../overlay/PopupMenu` | TRIVIAL — type-only swap |
| `tree-provider/CategoryView.tsx` | `TextField`, `Button` from `../basic/`; uses `@emotion/styled` for a 60-line CategoryViewRoot block | NON-TRIVIAL — per-screen migration |
| `file-search/FileSearch.tsx` | `TextField`, `Button` from `../basic/`; uses `@emotion/styled` for a 100-line FileSearchRoot block | NON-TRIVIAL — per-screen migration |

### Why the styled blocks stay

Both `CategoryView.tsx` and `FileSearch.tsx` use `@emotion/styled`
for **internal layout primitives** that compose UIKit Tree /
RenderGrid / LinksList outputs into a CSS-grid-like row layout.
Per Rule 7's "foundational compositional primitive exception"
(`uikit/CLAUDE.md`), components that orchestrate multi-region
layouts with caller-styled regions can keep their styled blocks
provided they import UIKit primitives for the simple controls
inside. **This task keeps the styled blocks intact** and only
swaps the `TextField` / `Button` / `MenuItem` imports to UIKit
equivalents. A future task may decide to extract the layout into
new UIKit primitives if it makes sense; that's not this task.

### Target API mappings

Verified against `uikit/Input/Input.tsx` and `uikit/IconButton/`:

| Legacy use | UIKit replacement | Notes |
|---|---|---|
| `<TextField ref={r} value onChange placeholder onKeyDown>` | `<Input ref={r} value onChange placeholder onKeyDown>` | shape-identical |
| `<TextField endButtons={[<Button .../>]}>` | `<Input endSlot={<IconButton .../>}>` | `endButtons` array → single `endSlot` ReactNode; legacy passed a one-element array in every callsite, so collapsing to a single slot is lossless |
| `<Button type="icon" size="small" title onClick>{<Icon/>}</Button>` | `<IconButton icon={<Icon/>} size="sm" title onClick>` | `type="icon"` becomes its own component; `size="small"` → `size="sm"`; child icon → `icon` prop |
| `<Button ... invisible={cond}>` | `{!cond && <IconButton .../>}` | UIKit IconButton has no `invisible` prop; conditional render is simpler and gives the same UX (no hover hit-target when empty) |
| `import type { MenuItem } from "../overlay/PopupMenu"` | `import type { MenuItem } from "../../uikit/Menu"` | shape-identical type per US-535's pattern |

## Implementation Plan

### Step 1 — Type-only flips (trivial)

Both files in `components/tree-provider/`:

```diff
-import type { MenuItem } from "../overlay/PopupMenu";
+import type { MenuItem } from "../../uikit/Menu";
```

Files:
- `src/renderer/components/tree-provider/CategoryViewModel.tsx` (line 3)
- `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` (line 5)

No JSX or runtime changes. Identical pattern to the US-535 flips
already merged (commit `f7aa6a6`).

### Step 2 — Migrate `FileSearch.tsx`

`src/renderer/components/file-search/FileSearch.tsx`:

#### 2a. Imports

```diff
-import { TextField } from "../basic/TextField";
-import { Button } from "../basic/Button";
+import { Input } from "../../uikit/Input";
+import { IconButton } from "../../uikit/IconButton";
```

#### 2b. Main search row (lines 265-282)

```diff
-<TextField
+<Input
     ref={searchInputRef}
     value={searchState.query}
     onChange={model.setQuery}
     placeholder="Search..."
     onKeyDown={handleKeyDown}
+    tone="accent"
 />
-<Button
-    type="icon"
-    size="small"
-    title="Toggle Filters"
-    onClick={model.toggleFilters}
->
-    {searchState.showFilters
-        ? <FilterArrowUpIcon width={14} height={14} />
-        : <FilterArrowDownIcon width={14} height={14} />}
-</Button>
+<IconButton
+    size="sm"
+    title="Toggle Filters"
+    onClick={model.toggleFilters}
+    icon={searchState.showFilters
+        ? <FilterArrowUpIcon width={14} height={14} />
+        : <FilterArrowDownIcon width={14} height={14} />}
+/>
```

`tone="accent"` paints the input text in the accent color (blue),
replacing the legacy styled-block's `.text-field input { color }`
override. Filter inputs stay on default tone.

#### 2c. Filter rows (lines 285-296)

```diff
-<TextField
+<Input
     value={searchState.includePattern}
     onChange={model.setIncludePattern}
     placeholder="Include (e.g. *.ts, *.tsx)"
 />
-<TextField
+<Input
     value={searchState.excludePattern}
     onChange={model.setExcludePattern}
     placeholder="Exclude (e.g. node_modules)"
 />
```

#### 2d. Keep the styled block

The `FileSearchRoot` styled.div (lines 41-143) stays unchanged —
it composes multi-row layout (input area + status + results
grid + row chrome) that wraps `RenderGrid`. Per Rule 7's
compositional-primitive exception, this is legitimate.

#### 2e. Styled-block cleanup — drop the obsolete `.text-field` rule

The legacy `FileSearchRoot` styled block targeted the
`.text-field` class (emitted by `<TextField>`) to apply
`color.misc.blue` to the search input's text. With the migration
to UIKit `<Input tone="accent">` from Step 2b, the styled override
is no longer needed — the accent tone owns the blue color.

```diff
 "& .fs-query-row": {
     display: "flex",
     alignItems: "center",
     gap: 2,
-    "& .text-field": {
-        flex: "1 1 auto",
-        "& input": {
-            color: color.misc.blue,
-        },
-    },
+    '& [data-type="input"]': {
+        flex: "1 1 auto",
+    },
 },
```

The `flex: "1 1 auto"` rule is kept (so the input fills the
remaining row width next to the filter-toggle IconButton), but
targets UIKit's `data-type="input"` attribute instead of the
legacy class. The color override is dropped entirely.

### Step 3 — Migrate `CategoryView.tsx`

`src/renderer/components/tree-provider/CategoryView.tsx`:

#### 3a. Imports

```diff
-import { TextField } from "../basic/TextField";
-import { Button } from "../basic/Button";
+import { Input } from "../../uikit/Input";
+import { IconButton } from "../../uikit/IconButton";
```

#### 3b. Toolbar element (lines 188-215)

```diff
-<TextField
+<Input
     ref={searchInputRef}
     value={state.searchText}
     onChange={model.setSearchText}
     placeholder="Search..."
     onKeyDown={handleSearchKeyDown}
-    endButtons={[
-        <Button
-            size="small"
-            type="icon"
-            key="close-search"
-            title="Clear"
-            onClick={handleSearchClose}
-            invisible={!state.searchText}
-        >
-            <CloseIcon />
-        </Button>,
-    ]}
+    endSlot={state.searchText
+        ? <IconButton
+              size="sm"
+              title="Clear"
+              onClick={handleSearchClose}
+              icon={<CloseIcon />}
+          />
+        : undefined}
 />
 {props.onViewModeChange && (
-    <Button type="icon" size="small" title="View Mode" onClick={handleViewModeMenu}>
-        {VIEW_MODE_ICONS[viewMode]}
-    </Button>
+    <IconButton
+        size="sm"
+        title="View Mode"
+        onClick={handleViewModeMenu}
+        icon={VIEW_MODE_ICONS[viewMode]}
+    />
 )}
```

`invisible` replaced with conditional rendering on `endSlot` —
when `searchText` is empty, the slot is omitted entirely. Same UX
(no clickable hit-target when there's nothing to clear) with one
less prop.

#### 3c. Keep the styled block

The `CategoryViewRoot` styled.div (lines 53-92) stays unchanged
for the same reason as FileSearch's — it composes
`LinksList` / `LinksTiles` / footer into a multi-region layout.

### Step 4 — Verify

- Grep `src/renderer/components/` for any remaining import of
  `../basic/`, `../form/`, `../layout/`, `../overlay/`, or
  `../TreeView/`. MUST be empty.
- `npx tsc --noEmit` — no NEW errors vs the documented 20-error
  baseline. The 6 errors introduced by US-532's first deletion
  attempt (which this task fixes) must all be gone.
- `npm run lint` — clean (no NEW warnings or errors).
- Manual smoke:
  - **FileSearch (Explorer Search secondary editor):** Open a
    folder in Explorer. In the Search panel, type a query → see
    matching files. Type more / fewer characters → filtering
    updates. Toggle filters → include/exclude inputs appear.
    Click a result line → opens the file at that line. Search
    input keeps the blue text color.
  - **CategoryView (LinkEditor category panel):** Open the
    LinkEditor. Navigate into a category. The toolbar search
    input appears (portalled). Type a query → list filters. Click
    the X icon (appears only when there's text) → clears search.
    Click the view-mode button → popup menu shows the 5 view
    modes; switching mode re-renders the list/tiles.
  - **TreeProvider context menus:** Right-click an item in the
    sidebar's Tree Provider list (Files, Recent, etc.). Verify
    the context menu items render (Copy / Rename / Delete /
    etc.). `MenuItem` type swap is shape-identical to US-535's
    pattern so no visual change is expected.

## Concerns

### A. `TextField` `endButtons` array vs UIKit `Input` `endSlot` single ReactNode

`CategoryView.tsx` passes `endButtons={[<Button .../>]}` (array of
one). UIKit `Input` accepts `endSlot` as a single `ReactNode`.

**Resolution:** Lossless collapse. The only caller in scope
(CategoryView) passes a single-element array, so the array
wrapper is dropped without behavior change. `FileSearch` doesn't
use `endButtons` so no change there.

### B. `Button.invisible` prop — no UIKit equivalent

Legacy `Button` accepts `invisible={cond}` which presumably hides
the button but reserves layout space (or hides entirely — needs
verification).

**Resolution:** Replaced with conditional rendering (`cond ? <X/> : undefined`)
on `endSlot`. When the search text is empty, the entire slot is
omitted, which means UIKit `Input` doesn't reserve space for it.
This is a minor visual change: instead of a "ghost" hit-target
in the slot when empty, the input gets the full slot width back.
Acceptable; UX is arguably better. Flagged in Step 4 smoke test
to verify.

### C. Search-input text color

`FileSearch.tsx`'s `FileSearchRoot` block applies `color.misc.blue`
to the search input via `.text-field input { color }`. UIKit
`Input` doesn't emit `.text-field` and the manual class-selector
override would be a Rule-7-adjacent hack.

**Resolution:** UIKit `Input` has a built-in `tone="accent"` prop
(verified in `uikit/Input/Input.tsx:29`). The search `<Input>`
gets `tone="accent"` directly, and the legacy `.text-field input
{ color }` rule is dropped from `FileSearchRoot` entirely. The
filter inputs (include / exclude patterns) stay on the default
tone. Cleaner, no class-selector dependency, and uses the
documented UIKit API.

Update to Step 2e reflects this: the styled-block keeps
`flex: "1 1 auto"` on the input (targeting `[data-type="input"]`
for the layout claim) but drops the color override.

### D. Styled blocks remain — is this Rule 7 compliant?

`FileSearchRoot` and `CategoryViewRoot` are large `@emotion/styled`
blocks inside `components/` (which is now the home for
persephone-coupled UIKit consumers). Rule 7 says app code outside
`src/renderer/uikit/` "must not use Emotion or any inline style
escape hatch when composing UIKit components" — but exempts
foundational compositional primitives with multi-region layouts.

**Resolution:** Both files compose multi-region layouts
(input + status + results-grid + row-chrome for FileSearch; toolbar
+ content + footer for CategoryView) and wrap `RenderGrid` /
`LinksList`. They sit in the same Rule 7 exemption space as the
new `components/` contract: persephone-coupled components that
use UIKit primitives for the simple controls and styled blocks
only for the orchestration layer. No extraction needed in this
task. Future refactoring may extract patterns into UIKit if
multiple consumers emerge.

### E. Should the styled blocks themselves migrate to `Panel` props?

`FileSearchRoot` and `CategoryViewRoot` could in principle be
expressed using nested UIKit `Panel` components with `direction`,
`gap`, `padding`, `flex` props. Doing so would eliminate the
remaining `@emotion/styled` in these files.

**Resolution:** Out of scope. This task is the minimum work
needed to unblock US-532. A future task may rewrite the layout
in `Panel` if/when the UIKit Panel surface covers everything the
current styled blocks express (especially the class-scoped child
selectors like `.fs-file-icon`, `.cv-footer`). For now, the
styled blocks stay as-is.

### F. Does this expand US-532's scope?

US-543 is, in effect, doing the work US-532 thought was already
done. The original US-532 plan claimed Concern B was verified;
the verification grep was incomplete. This task corrects that
gap.

**Resolution:** No scope expansion to US-532 itself. US-532's
plan remains "delete the 5 primitive folders". US-543 simply
becomes US-532's last remaining blocker, replacing US-542 (which
also went green earlier today). After US-543 lands, US-532 can
proceed as originally planned.

## Acceptance criteria

- [ ] `CategoryViewModel.tsx` imports `MenuItem` from
      `../../uikit/Menu` (not `../overlay/PopupMenu`).
- [ ] `TreeProviderViewModel.tsx` imports `MenuItem` from
      `../../uikit/Menu` (not `../overlay/PopupMenu`).
- [ ] `FileSearch.tsx` imports `Input` + `IconButton` from
      `../../uikit/*` (not `TextField` / `Button` from
      `../basic/*`).
- [ ] `CategoryView.tsx` imports `Input` + `IconButton` from
      `../../uikit/*` (not `TextField` / `Button` from
      `../basic/*`).
- [ ] All `<TextField>` JSX usages flipped to `<Input>`.
- [ ] All `<Button type="icon">` JSX usages flipped to
      `<IconButton>` with `icon=` prop.
- [ ] `CategoryView.tsx` `endButtons` array migrated to
      `endSlot` ReactNode (conditional render when searchText
      empty).
- [ ] `FileSearch.tsx` search input uses UIKit `Input tone="accent"`
      for the blue text color; the legacy `.text-field input { color }`
      override is removed from `FileSearchRoot`.
- [ ] Repo-wide grep
      `from "\.\./(basic|form|layout|overlay|TreeView)/` in
      `src/renderer/components/` returns zero matches.
- [ ] `npx tsc --noEmit` reports no NEW errors vs the documented
      20-error baseline.
- [ ] `npm run lint` — clean (no NEW warnings or errors).
- [ ] Manual smoke (Step 4) passes — FileSearch, CategoryView,
      and TreeProvider context menus all behave identically to
      before.

## Files Changed (expected)

| Path | Change |
|---|---|
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | `MenuItem` type import path |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | `MenuItem` type import path |
| `src/renderer/components/tree-provider/CategoryView.tsx` | `TextField` → `Input`, `Button` → `IconButton`, `endButtons` array → `endSlot` ReactNode |
| `src/renderer/components/file-search/FileSearch.tsx` | `TextField` → `Input`, `Button` → `IconButton`, styled-block class selector updated |

## Files NOT changed

- `FileSearchModel.ts`, `CategoryViewModel.tsx` (apart from the
  MenuItem import), `TreeProviderViewModel.tsx` (apart from the
  MenuItem import) — all model classes are unchanged. The
  migration is JSX + import-only on the View side.
- `TreeProviderItemIcon.tsx`, `favicon-cache.ts`, `index.ts` —
  no legacy primitive imports; left as-is.
- `components/icons/`, `components/page-manager/` — already clean
  (verified via the Step 4 grep pattern).
- `components/basic/`, `components/overlay/` themselves — deleted
  by US-532 after this task lands.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration of legacy primitive consumers
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  — deletion of `components/basic/` + `components/overlay/`
- Related:
  - [US-535](../US-535-menuitem-import-flips/README.md) —
    established the `MenuItem` type-flip pattern (commit
    `f7aa6a6`); reuses the same shape-compatible swap here
  - [US-542](../US-542-grid-options-popover-flip/README.md) —
    sibling cleanup task that did the analogous `Popper` →
    `Popover` flip
