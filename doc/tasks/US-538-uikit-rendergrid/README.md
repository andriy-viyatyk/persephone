# US-538: UIKit `RenderGrid` — virtualization primitive promotion

## Status

**Implemented (review deferred).** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 — UIKit foundational primitive. Deferred-review model: this
task does NOT run `/review`, `/document`, or `/userdoc` — those run
at epic close.

### Implementation summary

- Folder moved via `git mv` (history preserved): 7 files relocated
  `components/virtualization/RenderGrid/` → `uikit/RenderGrid/`.
- `components/virtualization/index.ts` deleted; folder removed.
- `components/index.ts` no longer re-exports `./virtualization`.
- `uikit/RenderGrid/index.ts` barrel created (~35 lines).
- `uikit/index.ts` gained Virtualization section with curated
  re-exports (`RenderGrid`, `RenderGridModel`, `RenderFlexGrid`, +
  common types).
- `RenderGridProps.name?: string` added; root emits
  `data-type="render-grid"` + `data-name={name}` (Rule 1).
  `RenderFlexGrid` inherits `name` automatically via prop spread.
- Internal external imports inside the moved folder shortened by one
  segment (`../../../core/state/model` → `../../core/state/model`,
  etc.).
- 24 consumer files updated: 6 UIKit internal (`uikit/ListBox/*`,
  `uikit/Tree/*`) flipped to relative `../RenderGrid`; 9 external
  editor callers and 9 legacy `components/` consumers flipped to
  `uikit/RenderGrid` barrel.
- `uikit/CLAUDE.md` Rule 7 section gained "Foundational
  compositional primitive exception" paragraph documenting the
  `RenderGrid`/`RenderFlexGrid` exemption.

`npx tsc --noEmit`: 20 pre-existing errors in 4 baseline files
(`automation/commands.ts`, `editors/video/VideoPlayerEditor.tsx`,
`scripting/worker/WorkerRunner.ts`, `ui/tabs/PageTab.tsx`) — no new
errors from US-538.

`npm run lint`: 20 errors, 896 warnings — all pre-existing baseline,
none in files touched by this task.

Manual UI smoke not yet performed (Storybook test surface awaiting).

## Goal

Promote the virtualization primitive currently at
`src/renderer/components/virtualization/RenderGrid/` into UIKit at
`src/renderer/uikit/RenderGrid/`. After this task:

- `src/renderer/components/virtualization/` no longer exists.
- UIKit `ListBox` and `Tree` import `RenderGrid` from a sibling
  UIKit path (`../RenderGrid`) instead of crossing into legacy
  `components/`.
- All 24 consumer files (9 external editor callers + 9 legacy
  `components/` consumers + 6 UIKit internal files) import via
  `uikit/RenderGrid`.
- `RenderGrid` and `RenderFlexGrid` conform to UIKit Rule 1
  (`data-type` + optional `name`/`data-name`).

Functional behavior is preserved verbatim. The component's public
API stays model-view based (callers construct `RenderGridModel`),
which matches the API style of `ListBox` / `Tree` — its closest
UIKit peers.

## Background

### Why RenderGrid belongs in UIKit

UIKit `ListBox` and `Tree` are both built on top of `RenderGrid` for
virtualised row rendering (`uikit/ListBox/ListBoxModel.ts`,
`uikit/Tree/TreeModel.ts`). The cross-folder import direction —
`uikit/ → components/virtualization/` — is the architectural smell:
a UIKit primitive should not depend on a legacy `components/` folder.
Relocating `RenderGrid` resolves that inversion.

The folder also has 9 direct editor callers that need a flexible
virtualised grid which `ListBox`/`Tree` don't cover (NotebookEditor's
flex grid, TodoEditor's row groups, LogViewEditor's output rows,
LinkEditor list/tile views, LinkTagsSecondaryEditor's tag column).
Those callers are legitimate UIKit consumers post-migration.

### Module inventory

`components/virtualization/RenderGrid/` — total ≈ 2,150 LOC, 7 files,
fully self-contained except for three external dependencies (resolved
relative to renderer root):

| File | LOC | Purpose |
|---|---|---|
| `RenderGrid.tsx` | 292 | Virtualised grid component (default export) |
| `RenderFlexGrid.tsx` | 246 | Flex-row variant on top of `RenderGrid` |
| `RenderGridModel.ts` | 539 | State + scroll/visibility logic (default export) |
| `renderInfo.ts` | 704 | Column/row sizing calculus |
| `rerender-check.ts` | 348 | Render-skip optimisation |
| `AsyncRef.ts` | 29 | Ref + promise helper |
| `types.ts` | 142 | Public types |

`components/virtualization/index.ts` is a 5-line barrel that
re-exports the above; it is deleted in this task. The
`components/index.ts` barrel re-exports it on line 14 — that line
also goes away.

### External dependencies (within the moved folder)

After the move, the relative depths of these three imports each
shorten by one level:

| From (current) | To (after move) | Module |
|---|---|---|
| `../../../core/state/model` | `../../core/state/model` | `TComponentModel`, `useComponentModel` |
| `../../../core/utils/memorize` | `../../core/utils/memorize` | `memorize` |
| `../../../../shared/utils` | `../../../shared/utils` | `debounce` |

All three resolve to the same target post-move. No cross-folder
breakage.

### Caller inventory (complete)

Twenty-five files in total import from `components/virtualization/`
today. Grouped:

**A. UIKit internal — switch to relative `../RenderGrid` barrel (6 files, 9 import lines)**

| File | Imports |
|---|---|
| `src/renderer/uikit/ListBox/ListBox.tsx` | `RenderGrid` (default), `ElementLength`, `Percent`, `RenderCellFunc` |
| `src/renderer/uikit/ListBox/ListBoxModel.ts` | `RenderGridModel` (default), `RowAlign` |
| `src/renderer/uikit/ListBox/types.ts` | `RowAlign` |
| `src/renderer/uikit/Tree/Tree.tsx` | `RenderGrid` (default), `ElementLength`, `Percent`, `RenderCellFunc` |
| `src/renderer/uikit/Tree/TreeModel.ts` | `RenderGridModel` (default), `RowAlign` |
| `src/renderer/uikit/Tree/types.ts` | `RowAlign` |

**B. External editor callers — switch to `../../uikit/RenderGrid` barrel (9 files, 19 import lines)**

| File | Imports |
|---|---|
| `src/renderer/editors/todo/TodoEditor.tsx` | `RenderFlexGrid`, `RenderFlexCellParams`, `RenderGridModel`, `Percent` |
| `src/renderer/editors/notebook/NotebookEditor.tsx` | `RenderFlexGrid`, `RenderFlexCellParams`, `RenderGridModel`, `Percent` |
| `src/renderer/editors/log-view/LogViewEditor.tsx` | `RenderFlexGrid`, `RenderFlexCellParams`, `RenderGridModel`, `Percent` |
| `src/renderer/editors/link-editor/LinksList.tsx` | `RenderGrid`, `RenderGridModel`, `RenderCellParams`, `RenderSizeOptional` |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | `RenderGrid`, `RenderGridModel`, `RenderCellParams`, `RenderSizeOptional` |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | `RenderGridModel` |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | `RenderGridModel` |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | `RenderGridModel` |
| `src/renderer/editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` | `RenderGridModel` (depth-3, uses `../../../uikit/RenderGrid`) |

**C. Legacy `components/` consumers — switch to `../../uikit/RenderGrid` barrel (9 files, 11 import lines)**

These folders are slated for either deletion (`TreeView`, `form`,
`data-grid`) or user-pending review (`tree-provider`, `file-search`)
in US-532. Until then they must compile, so their imports flip in
this task.

| File | Imports |
|---|---|
| `src/renderer/components/TreeView/TreeView.tsx` | `RenderGrid`, `Percent`, `RenderCellParams` |
| `src/renderer/components/TreeView/TreeView.model.ts` | `RenderGridModel` |
| `src/renderer/components/form/List.tsx` | `RenderGrid`, `RenderGridModel`, `Percent`, `RenderCellFunc` |
| `src/renderer/components/tree-provider/CategoryView.tsx` | `RenderGridModel` |
| `src/renderer/components/file-search/FileSearch.tsx` | `RenderGrid`, `RenderGridModel`, `RenderCellParams` |
| `src/renderer/components/data-grid/AVGrid/AVGrid.tsx` | `RenderGrid`, `RefType`, `RenderCellFunc` |
| `src/renderer/components/data-grid/AVGrid/avGridTypes.ts` | `Percent`, `RenderCellParams`, `RerenderInfo` |
| `src/renderer/components/data-grid/AVGrid/model/AVGridModel.ts` | `RenderGridModel`, `RerenderInfo` (depth-3, uses `../../../../uikit/RenderGrid`) |
| `src/renderer/components/data-grid/AVGrid/model/FocusModel.ts` | `RenderCell` (depth-3, uses `../../../../uikit/RenderGrid`) |

**D. Cleanup (1 file)**

| File | Change |
|---|---|
| `src/renderer/components/index.ts` | Remove line 14 — `export * from './virtualization';` |

### Sequencing vs other epic tasks

- **US-538 (this) runs before US-536.** US-536 (AVGrid migration)
  is listed as "blocked on US-538 + US-539" — once `RenderGrid` is in
  UIKit, US-536 can move `components/data-grid/AVGrid/` into
  `uikit/AVGrid/`. US-538 updates AVGrid's `RenderGrid` imports
  in-place to point at `uikit/RenderGrid`; US-536 will re-touch those
  files when it relocates AVGrid (minor churn, unavoidable).
- **US-538 leaves `components/TreeView/`, `components/form/`,
  `components/tree-provider/`, `components/file-search/` intact** —
  they just get their imports flipped. US-532 (final sweep) and
  US-537 (RestClient `TreeView` flip) handle their later removal /
  relocation.
- **US-538 unblocks US-532 deletion of `components/virtualization/`.**

### `RenderGrid` public API today

`RenderGridProps` exposes `className`, `contentProps`,
`renderAreaProps`, and `blockStyles` — all CSS escape hatches.
**This is intentional and stays.** `RenderGrid` is a foundational
compositional primitive whose entire purpose is to host
caller-styled regions (sticky-top, sticky-left, render area). AVGrid
in particular depends on `blockStyles` to override sticky-zone
backgrounds and on `contentProps` for cell-grid event wiring.

Rule 7 ("no Emotion outside UIKit / no `style`/`className` on UIKit
components") applies to **consumers** of UIKit, not to UIKit's own
internal compositional primitives. `Button` / `Input` Omit `style`
and `className` from `HTMLAttributes` because they wrap a single
HTML element. `RenderGrid` is a multi-region composition with public
slots — the escape hatches *are* its API. We document this as a
Rule-7 exemption in the moved CLAUDE.md (see Concern A).

What does change in the public API:

- **Add `name?: string`** (US-521 alignment). Emit `data-name={name}`
  on the root alongside `data-type="render-grid"`.
- **Add `data-type="render-grid"`** on the root (Rule 1).
- `RenderFlexGrid` extends `RenderGridProps` via `Omit<…,
  "renderCell">`, so `name` is inherited automatically and reaches
  the inner `RenderGrid` via `{...restProps}` spread — no extra
  wiring needed.

## Implementation plan

### Step 1 — Move folder

Move `src/renderer/components/virtualization/RenderGrid/` →
`src/renderer/uikit/RenderGrid/`. Use `git mv` for each of the 7
files so history is preserved:

```
git mv src/renderer/components/virtualization/RenderGrid/RenderGrid.tsx          src/renderer/uikit/RenderGrid/RenderGrid.tsx
git mv src/renderer/components/virtualization/RenderGrid/RenderFlexGrid.tsx      src/renderer/uikit/RenderGrid/RenderFlexGrid.tsx
git mv src/renderer/components/virtualization/RenderGrid/RenderGridModel.ts      src/renderer/uikit/RenderGrid/RenderGridModel.ts
git mv src/renderer/components/virtualization/RenderGrid/renderInfo.ts           src/renderer/uikit/RenderGrid/renderInfo.ts
git mv src/renderer/components/virtualization/RenderGrid/rerender-check.ts       src/renderer/uikit/RenderGrid/rerender-check.ts
git mv src/renderer/components/virtualization/RenderGrid/AsyncRef.ts             src/renderer/uikit/RenderGrid/AsyncRef.ts
git mv src/renderer/components/virtualization/RenderGrid/types.ts                src/renderer/uikit/RenderGrid/types.ts
```

Then delete the now-empty:
- `src/renderer/components/virtualization/index.ts`
- `src/renderer/components/virtualization/` directory itself

### Step 2 — Shorten internal relative imports inside the moved folder

The moved files reach three modules outside their folder. Depth
shrinks by one segment (`../../../X` → `../../X`):

**`uikit/RenderGrid/RenderGrid.tsx` (line 9):**
```ts
// before
import { useComponentModel } from '../../../core/state/model';
// after
import { useComponentModel } from '../../core/state/model';
```

**`uikit/RenderGrid/RenderGridModel.ts` (line 21):**
```ts
// before
import { TComponentModel } from '../../../core/state/model';
// after
import { TComponentModel } from '../../core/state/model';
```

**`uikit/RenderGrid/RenderFlexGrid.tsx` (lines 2, 9, 10):**
```ts
// before
import { TComponentModel, useComponentModel } from "../../../core/state/model";
import { debounce } from "../../../../shared/utils";
import { memorize } from "../../../core/utils/memorize";
// after
import { TComponentModel, useComponentModel } from "../../core/state/model";
import { debounce } from "../../../shared/utils";
import { memorize } from "../../core/utils/memorize";
```

All other imports inside the folder are intra-folder (`./types`,
`./renderInfo`, `./RenderGridModel`, etc.) and need no changes.

### Step 3 — Create `uikit/RenderGrid/index.ts` barrel

```ts
// src/renderer/uikit/RenderGrid/index.ts
export { default as RenderGrid } from "./RenderGrid";
export { default as RenderGridModel } from "./RenderGridModel";
export { defaultRenderGridState, defaultRowHeight } from "./RenderGridModel";
export type { RenderGridProps, RenderGridModelInput, BlockStyles } from "./RenderGridModel";
export { RenderFlexGrid } from "./RenderFlexGrid";
export type {
    RenderFlexCellParams,
    RenderFlexCellFunc,
    RenderFlexGridProps,
} from "./RenderFlexGrid";
export type {
    Percent,
    RenderCellFunc,
    RenderCellParams,
    RenderSizeOptional,
    RenderSize,
    ElementLength,
    RenderCell,
    RowAlign,
    RerenderInfo,
    RefType,
    RenderInputPrepared,
    RenderInnerSize,
    RenderPoint,
    RenderRect,
    RenderLength,
    RenderCellMap,
    RenderCellKey,
    RenderRange,
    RenderInfoObject,
    RenderInfoCellObject,
    RerenderInfoPrepared,
    AdjustRenderRangeFunc,
    RanderedRange,
    RenderInput,
    CalcRenderInfoInput,
    RenderData,
} from "./types";
```

This barrel becomes the single import surface for consumers. No
consumer needs to know whether a symbol lives in `RenderGrid.tsx`,
`RenderGridModel.ts`, `RenderFlexGrid.tsx`, or `types.ts`.

### Step 4 — Add `name?: string` + Rule-1 conformance to `RenderGrid`

In `uikit/RenderGrid/RenderGridModel.ts`:

```ts
export interface RenderGridProps {
    /** Optional debug label emitted as `data-name` on the root.
     *  Use to disambiguate multiple instances in DOM inspector output.
     *  Never used for styling. */
    name?: string;
    rowCount: number | (() => number);
    // …existing props…
}
```

In `mapProps`, destructure and forward `name`:

```ts
const {
    name,
    rowCount = 0,
    // …
} = props;

return {
    name,
    rowCount,
    // …
};
```

In `uikit/RenderGrid/RenderGrid.tsx`, add the data attributes:

```tsx
return (
    <RenderGridRoot
        data-type="render-grid"
        data-name={model.props.name}
        id="avg-root"
        ref={model.gridRef.ref as RefType<HTMLDivElement>}
        className={model.props.className}
        style={{ /* unchanged */ }}
        {...(model.props.contentProps || {})}
    >
        {/* …unchanged… */}
    </RenderGridRoot>
);
```

`id="avg-root"`, `id="avg-container"`, and `id="avg-render-area"`
stay as-is (see Concern E for rationale).

`RenderFlexGrid` requires no change for `name` — it extends
`RenderGridProps` and forwards via `{...restProps}` into `RenderGrid`.

### Step 5 — Update UIKit barrel `uikit/index.ts`

Add a new "Virtualization" section (between Layout and Bootstrap, or
after Lists — order is taste; matches alphabetical of the section
header):

```ts
// Virtualization (foundational primitive — consumed by ListBox, Tree, AVGrid, editor lists)
export { RenderGrid, RenderGridModel, RenderFlexGrid } from "./RenderGrid";
export type {
    RenderGridProps,
    RenderFlexGridProps,
    RenderFlexCellParams,
    RenderCellParams,
    RenderCellFunc,
    Percent,
    RowAlign,
} from "./RenderGrid";
```

Curated subset only — the rest of the types stay accessible via the
folder barrel `uikit/RenderGrid` for deep-typed callers.

### Step 6 — Flip UIKit internal imports to `../RenderGrid`

Six files in `uikit/ListBox/` and `uikit/Tree/` switch from the
cross-folder import to a sibling-folder relative import. Use the
folder barrel:

**`uikit/ListBox/ListBox.tsx` (lines 6, 7–11):**
```ts
// before
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import {
    ElementLength,
    Percent,
    RenderCellFunc,
} from "../../components/virtualization/RenderGrid/types";
// after
import { RenderGrid } from "../RenderGrid";
import type {
    ElementLength,
    Percent,
    RenderCellFunc,
} from "../RenderGrid";
```

**`uikit/ListBox/ListBoxModel.ts` (lines 4–5):**
```ts
// before
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RowAlign } from "../../components/virtualization/RenderGrid/types";
// after
import { RenderGridModel } from "../RenderGrid";
import type { RowAlign } from "../RenderGrid";
```

**`uikit/ListBox/types.ts` (line 7):**
```ts
// before
import { RowAlign } from "../../components/virtualization/RenderGrid/types";
// after
import type { RowAlign } from "../RenderGrid";
```

**`uikit/Tree/Tree.tsx`, `uikit/Tree/TreeModel.ts`, `uikit/Tree/types.ts`** — same shape as their `ListBox/` counterparts, applied verbatim.

### Step 7 — Flip 9 external editor caller imports

All targeted via `../../uikit/RenderGrid` (depth-2 callers) or
`../../../uikit/RenderGrid` (depth-3 caller).

**`editors/todo/TodoEditor.tsx` (lines 8–13 currently):**
```ts
// before
import {
    RenderFlexCellParams,
    RenderFlexGrid,
} from "../../components/virtualization/RenderGrid/RenderFlexGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { Percent } from "../../components/virtualization/RenderGrid/types";
// after
import {
    RenderFlexGrid,
    RenderGridModel,
} from "../../uikit/RenderGrid";
import type { RenderFlexCellParams, Percent } from "../../uikit/RenderGrid";
```

**`editors/notebook/NotebookEditor.tsx`, `editors/log-view/LogViewEditor.tsx`** — identical shape.

**`editors/link-editor/LinksList.tsx` (lines 2–4):**
```ts
// before
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RenderCellParams, RenderSizeOptional } from "../../components/virtualization/RenderGrid/types";
// after
import { RenderGrid, RenderGridModel } from "../../uikit/RenderGrid";
import type { RenderCellParams, RenderSizeOptional } from "../../uikit/RenderGrid";
```

**`editors/link-editor/LinksTiles.tsx`** — same shape.

**`editors/link-editor/LinkItemList.tsx`, `LinkItemTiles.tsx`, `LinkViewModel.ts`** (each single-line):
```ts
// before
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
// after
import { RenderGridModel } from "../../uikit/RenderGrid";
```

**`editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` (line 11)** — depth-3, one more `../`:
```ts
// before
import RenderGridModel from "../../../components/virtualization/RenderGrid/RenderGridModel";
// after
import { RenderGridModel } from "../../../uikit/RenderGrid";
```

### Step 8 — Flip 9 legacy `components/` consumer imports

**Depth-2 (`components/<x>/Y.tsx`)** — use `../../uikit/RenderGrid`:

- `components/TreeView/TreeView.tsx` (lines 7–8)
- `components/TreeView/TreeView.model.ts` (line 2)
- `components/form/List.tsx` (lines 16–18)
- `components/tree-provider/CategoryView.tsx` (line 5)
- `components/file-search/FileSearch.tsx` (lines 9–11)
- `components/data-grid/AVGrid/AVGrid.tsx` (lines 13, 15)
- `components/data-grid/AVGrid/avGridTypes.ts` (line 2)

Example (`components/form/List.tsx`):
```ts
// before
import RenderGrid from "../virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../virtualization/RenderGrid/RenderGridModel";
import { Percent, RenderCellFunc } from "../virtualization/RenderGrid/types";
// after
import { RenderGrid, RenderGridModel } from "../../uikit/RenderGrid";
import type { Percent, RenderCellFunc } from "../../uikit/RenderGrid";
```

**Depth-3 (`components/<x>/<y>/Z.ts`)** — use `../../../uikit/RenderGrid`:

- `components/data-grid/AVGrid/model/AVGridModel.ts` (lines 10–11)
- `components/data-grid/AVGrid/model/FocusModel.ts` (line 6)

Example (`components/data-grid/AVGrid/model/AVGridModel.ts`):
```ts
// before
import RenderGridModel from "../../../virtualization/RenderGrid/RenderGridModel";
import { RerenderInfo } from "../../../virtualization/RenderGrid/types";
// after
import { RenderGridModel } from "../../../../uikit/RenderGrid";
import type { RerenderInfo } from "../../../../uikit/RenderGrid";
```

### Step 9 — Remove `components/virtualization/` barrel reference

**`src/renderer/components/index.ts`** — delete line 14:
```ts
// before
// Virtualization components
export * from './virtualization';

// after
// (line removed)
```

The blank "Virtualization components" comment line above goes too.

### Step 10 — Verify

```
npm run lint
npx tsc --noEmit
```

Both must report no new errors relative to baseline. Pre-existing
errors in `automation/commands.ts`, `WorkerRunner.ts`,
`VideoPlayerEditor.tsx`, `PageTab.tsx` are unrelated and should
remain unchanged in count.

Then run the manual smoke checklist (Test surface section).

## Concerns / open questions

### A. Rule 7 vs. `className`/`blockStyles`/`contentProps` exposure — RESOLVED

**Decision:** `RenderGrid` and `RenderFlexGrid` are documented as
Rule-7 exemptions in this folder. Rationale:

- Rule 7 forbids `style` / `className` on UIKit components **that
  consumers compose** (Button, Input, Panel). It targets app code,
  not foundational primitives.
- `RenderGrid` is a multi-region composition (sticky-top,
  sticky-bottom, sticky-left, sticky-right, sticky-corners, render
  area). Callers — most notably AVGrid and the editor lists —
  legitimately need to style those regions. The escape hatches
  (`className`, `contentProps`, `renderAreaProps`, `blockStyles`)
  *are* the API; removing them would force a much wider prop
  surface that exposes individual CSS knobs per region.
- `RenderGridProps` does not extend `HTMLAttributes`, so the
  type-level Omit enforcement is not applicable in the first place.

**Action:** add a short rationale comment in `RenderGridProps` near
`className` / `blockStyles` so future readers know the design is
intentional. Add the exemption to `uikit/CLAUDE.md` "Rule 7" section
under "When this rule may be relaxed."

### B. `Percent` and other helper types — RESOLVED

Keep all types exported from `uikit/RenderGrid/types.ts`. Re-export
the commonly used subset (`Percent`, `RowAlign`, `RenderCellParams`,
`RenderCellFunc`) from the top-level `uikit` barrel for
discoverability; deep types stay accessible via `uikit/RenderGrid`.

### C. Storybook story — RESOLVED

Defer indefinitely. A meaningful `RenderGrid` story needs a
caller-constructed `RenderGridModel`, custom `renderCell`, and
controlled scroll/row state — closer to a dedicated demo editor than
a Storybook prop-panel story. `ListBox` and `Tree` stories already
exercise the underlying virtualisation surface for QA purposes.

### D. `components/virtualization/index.ts` and `components/index.ts:14` — RESOLVED

Pure barrel re-exports. Delete both. No external code imports from
either (verified — there are no `from "../components"` matches in
`src/`, and the inner `from "./virtualization"` is the only line
that points at the deleted folder).

### E. `id="avg-root"` / `id="avg-container"` / `id="avg-render-area"` collision risk — RESOLVED (deferred clean-up)

`RenderGrid.tsx` hardcodes three DOM ids on its inner divs. Multiple
`RenderGrid` instances on the same page therefore produce duplicate
ids — semantically invalid HTML, though functionally tolerated.

External selector usage (verified via grep):
- `id="avg-root"` — **no external selector**
- `id="avg-container"` — used by `editors/notebook/NoteItemViewModel.ts`
  (lines 247, 280) via `element.closest("#avg-container")`. `closest`
  walks up from a known descendant, so duplicate ids are resolved
  correctly (it picks the nearest ancestor).
- `id="avg-render-area"` — **no external selector**

**Decision:** keep all three ids as-is for this task. Scope creep is
not worth the marginal gain. File a follow-up to convert them to
`data-region="root|container|render-area"` (and update the two
`NoteItemViewModel` selectors) once US-538 lands and the file has
settled in its new home.

### F. Sequencing vs US-536 (AVGrid migration) — RESOLVED

US-538 lands before US-536. AVGrid (4 files) gets its `RenderGrid`
imports flipped to `uikit/RenderGrid` in-place; US-536 will later
move AVGrid wholesale into `uikit/AVGrid/` and re-touch those same
files (the imports become intra-`uikit/` relative). Minor churn,
unavoidable: it's the price of doing the foundation move first.

## Acceptance criteria

- [ ] `src/renderer/components/virtualization/` no longer exists.
- [ ] `src/renderer/uikit/RenderGrid/` contains the 7 migrated
      module files + `index.ts` barrel.
- [ ] `RenderGrid` root element carries
      `data-type="render-grid"` and `data-name={name}` (when `name`
      prop is set).
- [ ] `RenderGridProps.name?: string` is part of the public API and
      reaches the root via `model.props.name`.
- [ ] `RenderFlexGrid` inherits `name` via `RenderGridProps` and
      forwards it through `{...restProps}` (no extra wiring needed).
- [ ] UIKit `ListBox` and `Tree` import `RenderGrid` / `RenderGridModel`
      via `../RenderGrid` (sibling folder), not via
      `../../components/...`.
- [ ] All 9 external editor caller files compile with imports
      pointing at `uikit/RenderGrid`.
- [ ] All 9 legacy `components/` consumer files compile with imports
      pointing at `uikit/RenderGrid`.
- [ ] `src/renderer/components/index.ts` no longer re-exports
      `./virtualization`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no NEW errors
      relative to the pre-task baseline.
- [ ] Manual smoke (Test surface section) passes on all five
      surfaces.
- [ ] `uikit/CLAUDE.md` Rule 7 section gains a paragraph documenting
      the `RenderGrid` / `RenderFlexGrid` exemption.

## Test surface (manual smoke)

- **NotebookEditor.** Open a large `.ipynb` or
  `notebook-from-content` page; rows virtualise; scroll works
  smoothly; expanding/collapsing cells re-measures heights.
- **TodoEditor.** Open a TodoEditor with grouped items; group rows
  render; expand/collapse virtualises children; row hover/active
  highlighting unchanged.
- **LogViewEditor.** Run a script with `app.log.info` in a loop
  (≥ 1000 entries); scroll smoothly; auto-scroll to bottom unchanged.
- **LinkEditor.** Open a LinkEditor with > 200 links; list view +
  tile view both virtualise; drag-and-drop unchanged.
- **AVGrid (via JSON Grid editor).** Open a large `.json` file in
  grid-json mode; sort, filter, multi-select, sticky header/column
  all unchanged.
- **Resize.** Resize the window across each surface; row count
  adapts without layout thrash.

## Files Changed

| Action | Path |
|---|---|
| **Moved** | `components/virtualization/RenderGrid/RenderGrid.tsx` → `uikit/RenderGrid/RenderGrid.tsx` |
| **Moved** | `components/virtualization/RenderGrid/RenderFlexGrid.tsx` → `uikit/RenderGrid/RenderFlexGrid.tsx` |
| **Moved** | `components/virtualization/RenderGrid/RenderGridModel.ts` → `uikit/RenderGrid/RenderGridModel.ts` |
| **Moved** | `components/virtualization/RenderGrid/renderInfo.ts` → `uikit/RenderGrid/renderInfo.ts` |
| **Moved** | `components/virtualization/RenderGrid/rerender-check.ts` → `uikit/RenderGrid/rerender-check.ts` |
| **Moved** | `components/virtualization/RenderGrid/AsyncRef.ts` → `uikit/RenderGrid/AsyncRef.ts` |
| **Moved** | `components/virtualization/RenderGrid/types.ts` → `uikit/RenderGrid/types.ts` |
| **Deleted** | `components/virtualization/index.ts` (5 lines) |
| **Deleted** | `components/virtualization/` (empty directory) |
| **New** | `uikit/RenderGrid/index.ts` (folder barrel — ~35 lines) |
| **Modified** | `uikit/RenderGrid/RenderGrid.tsx` — shortened external imports + `data-type` / `data-name` |
| **Modified** | `uikit/RenderGrid/RenderGridModel.ts` — shortened external imports + `name?: string` prop |
| **Modified** | `uikit/RenderGrid/RenderFlexGrid.tsx` — shortened external imports |
| **Modified** | `uikit/index.ts` — add Virtualization barrel section |
| **Modified** | `uikit/CLAUDE.md` — Rule 7 exemption paragraph |
| **Modified** | `uikit/ListBox/ListBox.tsx`, `ListBoxModel.ts`, `types.ts` — relative `../RenderGrid` |
| **Modified** | `uikit/Tree/Tree.tsx`, `TreeModel.ts`, `types.ts` — relative `../RenderGrid` |
| **Modified** | `editors/todo/TodoEditor.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `editors/notebook/NotebookEditor.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `editors/log-view/LogViewEditor.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `editors/link-editor/LinksList.tsx`, `LinksTiles.tsx`, `LinkItemList.tsx`, `LinkItemTiles.tsx`, `LinkViewModel.ts` — `../../uikit/RenderGrid` |
| **Modified** | `editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` — `../../../uikit/RenderGrid` |
| **Modified** | `components/TreeView/TreeView.tsx`, `TreeView.model.ts` — `../../uikit/RenderGrid` |
| **Modified** | `components/form/List.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `components/tree-provider/CategoryView.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `components/file-search/FileSearch.tsx` — `../../uikit/RenderGrid` |
| **Modified** | `components/data-grid/AVGrid/AVGrid.tsx`, `avGridTypes.ts` — `../../uikit/RenderGrid` |
| **Modified** | `components/data-grid/AVGrid/model/AVGridModel.ts`, `FocusModel.ts` — `../../../../uikit/RenderGrid` |
| **Modified** | `components/index.ts` — drop `export * from './virtualization';` |

**Estimated:** 7 moved + 2 deleted + 1 new + ~26 modified files.

## Files that need NO changes

These files contain the strings `RenderGrid` or `RenderGridModel` but
do not import them from `components/virtualization/`. Already
checked — leave them alone:

- `src/renderer/editors/todo/TodoViewModel.ts` — references the type
  via the surrounding view file's import; no direct import.
- `src/renderer/editors/notebook/NoteItemViewModel.ts` — references
  the type via the surrounding view file's import; no direct
  `RenderGrid*` import. (It does use `element.closest("#avg-container")`
  on lines 247 + 280 — that selector continues to work; the id stays.)
- `src/renderer/editors/log-view/LogViewModel.ts` — references the
  type via the surrounding view file's import; no direct import.

Confirm via `grep -n "RenderGrid\|virtualization" <file>` returning
no import lines.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit foundational primitive
- Composes / consumes: none (RenderGrid is foundational)
- Consumed by (UIKit): [US-468](../US-468-uikit-listbox/README.md)
  (ListBox), [US-485](../US-485-uikit-tree/README.md) (Tree)
- Unblocks:
  [US-536](../US-536-uikit-datagrid/README.md) AVGrid migration,
  [US-532](../US-532-legacy-components-removal/README.md) deletion of
  `components/virtualization/`
- Related: [US-521](../US-521-uikit-name-debug-attribute/README.md)
  `name` debug prop adoption
