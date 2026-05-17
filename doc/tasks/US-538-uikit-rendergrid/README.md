# US-538: UIKit `RenderGrid` — virtualization primitive promotion

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 —
UIKit foundational primitive. Deferred-review model: this task does
NOT run `/review`, `/document`, or `/userdoc` — those run at epic
close.

## Goal

Promote the virtualization primitive currently at
`src/renderer/components/virtualization/RenderGrid/` into UIKit at
`src/renderer/uikit/RenderGrid/`. After this task, the legacy folder
has zero callers, UIKit `ListBox` / `Tree` import `RenderGrid` from
its UIKit home (a relative `../RenderGrid/` rather than a cross-folder
`../../components/...`), and the six direct editor callers update
their import paths.

Functionality is preserved verbatim. `RenderGrid` is already a
foundational primitive (it powers UIKit `ListBox`, `Tree`, and several
editors directly); this task formalises that role by relocating it
into UIKit and exposing it as a public UIKit primitive.

## Background

### Why RenderGrid belongs in UIKit

UIKit `ListBox` and `Tree` are built on top of `RenderGrid` for
virtualized row rendering (`uikit/ListBox/ListBoxModel.ts`,
`uikit/Tree/TreeModel.ts`). The cross-folder import
`uikit → components/virtualization/` is an architectural smell — a
UIKit primitive depending on legacy `components/`. Relocating
`RenderGrid` resolves that direction reversal.

The folder also has 6+ direct callers in editor code that need a
flexible virtualized grid which `ListBox`/`Tree` don't cover
(`NotebookEditor`'s flex grid, `TodoEditor`'s row groups,
`LogViewEditor`'s output rows, the link-editor list/tile views). Those
callers are legitimate UIKit consumers post-migration.

### Module inventory (size)

`components/virtualization/RenderGrid/` total ≈ 2,150 LOC across:

- `RenderGrid.tsx` (292) — virtualized grid component
- `RenderFlexGrid.tsx` (246) — flex-row variant
- `RenderGridModel.ts` (539) — state + scroll/visibility logic
- `renderInfo.ts` (704) — column/row sizing calculus
- `rerender-check.ts` (348) — render-skip optimisation
- `AsyncRef.ts` (29) — small helper
- `types.ts` (142) — public types

The folder lifts wholesale into `uikit/RenderGrid/` with internal
imports retargeted.

### External callers (direct, outside UIKit)

| File | Imports |
|---|---|
| `editors/link-editor/LinkItemList.tsx` | `RenderGridModel` |
| `editors/link-editor/LinkItemTiles.tsx` | `RenderGridModel` |
| `editors/link-editor/LinkViewModel.ts` | `RenderGridModel` |
| `editors/link-editor/LinksList.tsx` | `RenderGrid`, `RenderGridModel` |
| `editors/link-editor/LinksTiles.tsx` | `RenderGrid`, `RenderGridModel` |
| `editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` | `RenderGridModel` |
| `editors/log-view/LogViewEditor.tsx` | `RenderGridModel`, `Percent`, `RenderFlexGrid` |
| `editors/notebook/NotebookEditor.tsx` | `RenderGridModel`, `Percent`, `RenderFlexGrid` |
| `editors/todo/TodoEditor.tsx` | `RenderGridModel`, `Percent`, `RenderFlexGrid` |

### Internal UIKit callers (already use it via cross-folder import)

- `uikit/ListBox/*` — uses `RenderGrid`, `RenderGridModel`
- `uikit/Tree/*` — uses `RenderGrid`, `RenderGridModel`

These flip from `../../components/virtualization/RenderGrid` to
`../RenderGrid` after relocation — much cleaner.

## Implementation plan (high-level)

1. **Move folder.** Relocate
   `src/renderer/components/virtualization/RenderGrid/` →
   `src/renderer/uikit/RenderGrid/`. Adjust all internal cross-imports
   if any (most likely none — the folder is self-contained).
2. **Delete the now-empty `components/virtualization/` wrapper.**
   The folder only contains `RenderGrid/` plus `index.ts`. The
   `index.ts` barrel becomes obsolete; remove it.
3. **UIKit barrel.** Add `RenderGrid` exports to
   `src/renderer/uikit/index.ts` (`RenderGrid`, `RenderFlexGrid`,
   `RenderGridModel`, plus public types like `Percent`).
4. **Update internal UIKit consumers.** Flip `uikit/ListBox/*` and
   `uikit/Tree/*` to use the relative `../RenderGrid/` path.
5. **Update external callers.** 9 files in the inventory above.
   Most can switch to importing from the `uikit` barrel.
6. **Rule 7 audit.** `RenderGrid` and `RenderFlexGrid` are
   primitives — confirm their public prop types omit `style` and
   `className` (or document an explicit exemption with rationale).
7. **Verify.** `npm run lint`, `npx tsc --noEmit`, manual smoke
   on NotebookEditor (scroll virtualization), TodoEditor (group
   rows), LogViewEditor (long output), LinkEditor list/tile views.

## Concerns / open questions

### A. Public API of `RenderGrid` vs. UIKit primitive conventions

UIKit primitives follow conventions like `name` debug prop (US-521),
Omit-spread-rest (memory feedback_uikit_spread_rest), `Panel`-style
size/flex props. `RenderGrid` predates these — its public surface
uses model-based wiring (callers construct a `RenderGridModel` and
pass it in). That model-view pattern is consistent with `Tree` /
`ListBox` themselves, so no conversion is needed; the `name` prop
should be added opportunistically.

**Recommendation:** keep the model-view API; add `name` if cheap;
don't try to rewrite the prop surface.

### B. `Percent` and other helper types

`Percent` is exported from the module and used by callers. It's a
simple type alias. Keep it exported from `uikit/RenderGrid/` (and
optionally re-export from the top-level `uikit` barrel for
discoverability).

### C. Storybook story

Same as US-536 — a story may take effort given the model-view
architecture. Defer to a follow-up unless trivial.

### D. The legacy `index.ts` at `components/virtualization/`

Pure barrel re-export. Delete with the folder.

## Acceptance criteria

- [ ] `src/renderer/components/virtualization/` no longer exists.
- [ ] `src/renderer/uikit/RenderGrid/` contains the migrated module.
- [ ] UIKit `ListBox` and `Tree` import `RenderGrid` via the
      relative `../RenderGrid/` path (no cross-folder import).
- [ ] All 9 external caller files compile and run after import-path
      swap.
- [ ] `RenderGrid` / `RenderFlexGrid` public prop types omit `style`
      and `className` (or carry a documented exemption).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Test surface) passes.

## Test surface (manual smoke)

- Open a large JSON file in NotebookEditor: rows virtualize, scroll
  works without jank.
- Open a TodoEditor with grouped items: groups render, expand/
  collapse virtualizes children.
- Run a script with high-volume `app.log.info` output:
  LogViewEditor scrolls smoothly.
- Open LinkEditor with many links: list view + tile view both
  virtualize.
- Resize the window: row count adapts, no layout thrash.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit foundational primitive
- Related: [US-468](../US-468-uikit-listbox/README.md),
  [US-485](../US-485-uikit-tree/README.md) — UIKit primitives that
  consume `RenderGrid`
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/virtualization/`
