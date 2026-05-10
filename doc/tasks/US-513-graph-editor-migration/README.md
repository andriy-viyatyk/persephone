# US-513: Graph editor — UIKit migration

## Status

**Placeholder** — not yet planned. Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration.

## Goal

Migrate the Graph editor chrome (force-graph view, tooltip, expansion
settings, detail panel, tuning sliders) to UIKit primitives. After this
task, the in-scope files contain no `@emotion/styled` definitions and
import nothing from `components/basic|form|layout|overlay/`.

## Scope

Five rendering files:

- `src/renderer/editors/graph/GraphView.tsx` — root, toolbar, canvas
  host, search highlight chrome.
- `src/renderer/editors/graph/GraphTooltip.tsx` — hover tooltip overlay
  for nodes/edges.
- `src/renderer/editors/graph/GraphExpansionSettings.tsx` — expansion
  rules editor (uses `ComboSelect`).
- `src/renderer/editors/graph/GraphDetailPanel.tsx` — selected-node
  detail panel.
- `src/renderer/editors/graph/GraphTuningSliders.tsx` — physics tuning
  sliders panel.

## Files NOT changed

- `src/renderer/editors/graph/GraphIcons.tsx` — pure icon defs (uses
  `theme/color` for SVG fills, no chrome) — leave unless Phase 4
  explicitly bans `theme/color` here.
- `src/renderer/editors/graph/GraphLegendPanel.tsx` — verified no chrome
  imports.
- `src/renderer/editors/graph/GraphViewModel.ts`,
  `ForceGraphRenderer.ts`, `GraphContextMenu.ts` — pure logic / type
  imports only.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` roots | UIKit `Panel` |
| `components/basic/Button` (toolbar) | UIKit `IconButton` / `Button` |
| `components/basic/CircularProgress` | UIKit `Spinner` |
| `components/basic/useHighlightedText` (`highlightText`) | keep — content-rendering helper, not chrome |
| `components/form/ComboSelect` | UIKit `Select` |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` (in `GraphContextMenu.ts` only) |
| `theme/color` (chrome) | dropped — Panel/Text tokens |

Confirmed import inventory (current):
- `GraphView.tsx`: `@emotion/styled`, `components/basic/{CircularProgress,useHighlightedText,Button}`, `theme/color`.
- `GraphTooltip.tsx`: `@emotion/styled`, `theme/color`.
- `GraphExpansionSettings.tsx`: `@emotion/styled`, `components/form/ComboSelect`, `theme/color`.
- `GraphDetailPanel.tsx`: `@emotion/styled`, `theme/color`.
- `GraphTuningSliders.tsx`: `@emotion/styled`, `theme/color`.

## Notes

- `useHighlightedText.highlightText` is a function helper (returns
  ReactNodes); confirm it stays in `components/basic/` or migrates with
  Notebook / MarkdownView — see US-512 / US-480 decision.
- Sliders: `GraphTuningSliders` likely uses native `<input type="range">`
  inside a styled wrapper. Check if a UIKit `Slider` primitive exists; if
  not, migrate to UIKit Panel + native `<input>` (allowed — non-UIKit
  raw HTML is fine, only `style=`/`className=` on UIKit components is
  banned).
- Tooltip: `GraphTooltip` is a positioned overlay floating above the
  canvas. UIKit `Tooltip` is for trigger-anchored hover; this is a
  cursor-tracking overlay, so likely use UIKit `Panel` with absolute
  positioning, NOT UIKit `Tooltip`. Flag in plan.
- The force-graph canvas itself (rendered via
  `ForceGraphRenderer.ts`) is unaffected.

## Test surface (manual smoke)

- Open a graph link: nodes/edges render in canvas.
- Hover a node: tooltip appears with title / metadata.
- Click a node: detail panel populates with properties.
- Adjust tuning sliders: physics react in real-time.
- Open expansion settings panel: dropdown (`ComboSelect` →
  `Select`) lets user pick expansion mode.
- Toolbar buttons (search, fit-to-view, expand-all, etc.) all work.
- Loading state shows the Spinner.

## Acceptance criteria

- [ ] No `@emotion/styled` import in any in-scope file.
- [ ] No imports from `components/basic|form|layout|overlay/` in any
      in-scope file (`useHighlightedText` exception documented in plan).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (above) passes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related: [US-472 UIKit Select](../US-472-uikit-select/README.md)
