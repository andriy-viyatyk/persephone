# US-513: Graph editor — UIKit migration

## Status

**Blocked on US-519.** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration. Most UIKit primitives are in place
(Panel, IconButton, Button, Input, Select, Spinner, SegmentedControl,
Checkbox), but three UIKit additions are bundled into the precursor
task [US-519](../US-519-uikit-graph-editor-precursors/README.md):

- **UIKit Slider primitive** — new component for `GraphTuningSliders`.
- **UIKit IconButton `strikethrough` prop** — for the group-toggle
  button's diagonal-line indicator.
- **UIKit Text `link` variant** — for hover-underline link styling on
  clickable text spans (selection-info, reveal-hidden, tooltip-link).

Once US-519 ships, US-513 status flips to "ready for implementation".

## Goal

Migrate the Graph editor chrome (force-graph view, tooltip, expansion
settings, detail panel, tuning sliders, legend panel) to UIKit primitives
and plain DOM elements with inline style. After this task:

- No `@emotion/styled` import in any in-scope file.
- No imports from `components/basic|form|layout|overlay/` in any in-scope
  file (`AVGrid` is the documented exception — Phase 4 does not migrate
  the grid).
- The force-graph canvas and its renderer logic (`ForceGraphRenderer.ts`)
  remain unchanged.

## Background

### Architecture context

`GraphView.tsx` is the editor's root. It owns a giant `GraphViewRoot`
`styled.div` that defines CSS for **every chrome surface across all
sibling components** — toolbar, search box, expansion tabs, search
results list, empty hint, **and the legend panel chrome** (`.graph-legend`,
`.legend-tabs`, `.legend-row`, etc.) consumed by `GraphLegendPanel.tsx`.

This is the load-bearing detail of the migration: **`GraphLegendPanel.tsx`
has no Emotion import today but currently renders `className="graph-legend"`,
`className="legend-tab"`, etc. — class names defined in
`GraphView.tsx`'s parent styled root.** Dropping `GraphViewRoot` will
strip the legend's styling. Therefore `GraphLegendPanel.tsx` IS in scope
and must own its own inline styles after this task.

Same situation, smaller scale, with the inline helper `GraphSearchResults`
inside `GraphView.tsx`: it relies on `.search-results`, `.search-result-row`,
etc. defined on the parent root. Those move to inline styles on its own
elements.

### Reference implementation: Notebook migration (US-512)

The Notebook editor migration (commit `c2c554b`) is the canonical
template for this task. It established the pattern that applies here:

1. Replace `styled.div` definitions with **inline-style constants** at
   the top of the file or plain `<div style={...}>` calls. Plain DOM
   elements with inline `style=` are permitted in app code — only UIKit
   components forbid `style=`/`className=` (Rule 7).
2. Use UIKit `Panel` for column/row layout containers where the prop
   palette is sufficient (direction, gap, padding, flex, overflow,
   border\*, position). For one-off positioning (absolute-positioned
   floating panels, opacity-hover behavior), use plain `<div
   style={...}>` instead — Panel doesn't support those.
3. Replace `components/basic/useHighlightedText.highlightText` with
   `highlight()` from `uikit/shared/highlight` — same signature, returns
   `<strong>` instead of `<span class="highlighted-text">`. Visual delta
   (bold instead of blue-tinted span) is accepted per the Notebook
   precedent.
4. Replace `components/basic/Button type="icon"` with UIKit `IconButton`
   (size `"sm"` → `size="small"` becomes `size="sm"`).
5. Replace `components/basic/CircularProgress` with UIKit `Spinner`.
6. Replace `components/form/ComboSelect` with UIKit `Select`.
7. For tab-strip UIs (radio-like horizontal segments), use UIKit
   `SegmentedControl`. For arbitrary buttons-styled-as-tabs (e.g. the
   legend's three-tab strip and the detail panel's tabs), keep them as
   plain `<button style={...}>` styled inline — these tabs have custom
   chrome (bottom-border accent) that `SegmentedControl` (filled pill)
   doesn't match visually.

### UIKit primitives confirmed available

`Panel`, `IconButton`, `Button`, `Input`, `Select`, `Spinner`,
`SegmentedControl`, `Checkbox`, `Text`. Verified from
`src/renderer/uikit/index.ts`.

### UIKit primitives intentionally NOT used

- **`Tooltip`** — UIKit `Tooltip` is trigger-anchored hover chrome.
  `GraphTooltip` is a cursor-tracking portal overlay with viewport-edge
  clamping. Keep as portal + plain `<div style={...}>`.
- **(None yet — see Prerequisites)** Earlier draft proposed using a
  native `<input type="range">` for tuning sliders; superseded by the
  UIKit Slider precursor task.

## Scope

Six files (one added from the prior placeholder):

- `src/renderer/editors/graph/GraphView.tsx` — root, toolbar, search
  cluster, expansion-tabs strip, empty-graph hint, inline
  `GraphSearchResults` helper.
- `src/renderer/editors/graph/GraphLegendPanel.tsx` — **added to scope**.
  Floating legend chrome currently styled via parent `GraphViewRoot`.
- `src/renderer/editors/graph/GraphTooltip.tsx` — portal-rendered
  floating tooltip.
- `src/renderer/editors/graph/GraphExpansionSettings.tsx` — expansion
  rules form (uses `ComboSelect`).
- `src/renderer/editors/graph/GraphDetailPanel.tsx` — selected-node
  detail panel with tabs + resizer + AVGrid sub-tabs.
- `src/renderer/editors/graph/GraphTuningSliders.tsx` — physics sliders.

## Files NOT changed

- `src/renderer/editors/graph/GraphIcons.tsx` — pure icon defs.
- `src/renderer/editors/graph/GraphViewModel.ts`,
  `GraphConnectivityModel.ts`, `GraphDataModel.ts`,
  `GraphExpansionModel.ts`, `GraphGroupModel.ts`, `GraphHighlightModel.ts`,
  `GraphSearchModel.ts`, `GraphVisibilityModel.ts` — pure logic / model
  files, no chrome.
- `src/renderer/editors/graph/ForceGraphRenderer.ts` — canvas renderer.
- `src/renderer/editors/graph/GraphContextMenu.ts` — type-only import of
  `MenuItem`; matches UIKit `Menu` already (`MenuItem` type re-export
  via `uikit`). No edit needed unless lint flags the import path —
  verify during implementation.
- `src/renderer/editors/graph/shapeGeometry.ts`,
  `types.ts`, `constants.ts`, `index.ts` — no chrome.

## Old → UIKit mapping

| Old | New | Notes |
|---|---|---|
| `styled.div` roots (`GraphViewRoot`, `GraphTooltipRoot`, `GraphDetailPanelRoot`, `GraphTuningSlidersRoot`, `GraphExpansionSettingsRoot`) | inline-style constants + plain `<div style={...}>` or UIKit `Panel` | Per Notebook precedent |
| `components/basic/Button type="icon" size="small"` | UIKit `IconButton size="sm"` | Toolbar Draw/Copy actions in `editorToolbarRefLast` portal |
| `components/basic/CircularProgress` | UIKit `Spinner` | Loading state |
| `components/basic/useHighlightedText.highlightText` | `highlight()` from `uikit/shared/highlight` | Pure function, `<strong>` not span |
| `components/form/ComboSelect` | UIKit `Select` | Root-node picker in expansion settings |
| `theme/color` (chrome usage) | retained — UIKit doesn't replace color tokens | `color.graph.*`, `color.border.*`, `color.background.*`, `color.text.*`, `color.warning.*`, `color.error.*` all still used |
| `react-dom` `createPortal` | retained | Used by tooltip + editor toolbar/footer portals |

## Implementation plan

### Step 1 — Migrate `GraphTooltip.tsx` (smallest, lowest risk)

**File:** `src/renderer/editors/graph/GraphTooltip.tsx`

Currently a `styled.div` portal with extensive nested CSS for badge,
title, id, props grid, copy button, link styling. Migrate to:

- Replace `import styled from "@emotion/styled"` with inline-style
  constants at the top of the file (one `const xxxStyle: React.CSSProperties`
  per logical element).
- Root: portal-rendered `<div style={rootStyle}>` (still uses
  `ReactDOM.createPortal`). Keep the `style` merge with computed
  `pos.left`/`pos.top`/`pos.maxHeight` exactly as today.
- All nested classes (`.tooltip-badge`, `.tooltip-title`, `.tooltip-id`,
  `.tooltip-props`, `.tooltip-key`, `.tooltip-value`, `.tooltip-link`,
  `.tooltip-header`, `.tooltip-header-content`, `.tooltip-copy`) become
  inline-style constants or applied directly.
- The two `<button className="tooltip-copy">` elements → UIKit
  `IconButton size="sm"` with `icon={...}` (CopyIcon/CheckIcon/OpenIcon
  components stay local).
- Tooltip-link hover (`text-decoration: underline`) — accept loss of
  hover underline animation, or implement via React `onMouseEnter`/
  `onMouseLeave` state. Recommend accept loss for now (rare use).

**Visual deltas:** tooltip copy buttons render as UIKit IconButton chrome
(slightly different hover background) instead of legacy mini-buttons.

### Step 2 — Migrate `GraphTuningSliders.tsx`

**File:** `src/renderer/editors/graph/GraphTuningSliders.tsx`

- Replace `GraphTuningSlidersRoot` with `<Panel direction="column"
  gap="xs" paddingX="sm" paddingY="sm" borderTop>` (verify Panel
  supports `borderTop`).
- Each row: `<Panel direction="row" align="center" gap="sm">` with
  `<Text size="sm" color="light">` label, **UIKit `Slider`** (precursor),
  `<Text size="sm" color="light">` value display.
- UIKit `Slider` props (from the precursor task) — `value`, `onChange`,
  `min`, `max`, `step`, `size="sm"`. Track + thumb styling owned by the
  primitive.
- Reset button: UIKit `Button size="sm" variant="ghost"`.

### Step 3 — Migrate `GraphExpansionSettings.tsx`

**File:** `src/renderer/editors/graph/GraphExpansionSettings.tsx`

- Replace `GraphExpansionSettingsRoot` with `<Panel direction="column"
  gap="xs" paddingX="sm" paddingY="sm">`.
- Each `.expansion-row` → `<Panel direction="row" align="center"
  gap="sm">`.
- Each `.expansion-label` → inline `<span style={labelStyle}>` (72px
  width).
- Native number `<input>` → UIKit `Input size="sm"` — passes value /
  onChange / placeholder / onBlur / onKeyDown via spread.
- `ComboSelect` → UIKit `Select`:
  - **Before:**
    ```tsx
    <ComboSelect
        selectFrom={nodeOptions}      // string[]
        getLabel={getNodeLabel}
        value={rootNode || AUTO_ROOT}
        onChange={onRootChange}
    />
    ```
  - **After (build items once):**
    ```tsx
    const items = useMemo(
        () => nodeOptions.map((v) => ({ value: v, label: getNodeLabel(v) })),
        [nodeOptions, getNodeLabel],
    );
    <Select
        size="sm"
        items={items}
        value={items.find((i) => i.value === (rootNode || AUTO_ROOT)) ?? null}
        onChange={(item) => onRootChange(item.value)}
        filterMode="contains"
    />
    ```
  - Pre-shape `IListBoxItem[]` matches Notebook migration's
    `SegmentedControl` `ISegment[]` pattern.
- Expansion note (`.expansion-note`) → `<Text size="sm" color="warning"
  italic>` if Text supports those tokens; otherwise inline `<span
  style={...}>`. Verify Text props.

### Step 4 — Migrate `GraphLegendPanel.tsx` (added to scope)

**File:** `src/renderer/editors/graph/GraphLegendPanel.tsx`

The legend chrome currently lives in `GraphViewRoot`'s nested CSS.
After Step 6 (GraphView migration) those classes vanish. This step
re-implements the chrome with inline styles owned by the legend itself.

- Root container: floating panel at `bottom: 8, left: 8`, width 260,
  with opacity-on-hover behavior. **Cannot use Panel** — opacity hover
  is one-off chrome. Implement as plain `<div style={rootStyle}>` with
  React state `isHovered` toggling opacity, matching the Notebook
  `NoteItemView` pattern.
- Header (`.legend-header`): `<div style={headerStyle}
  onClick={toggleExpanded}>` — UIKit Panel could work here (direction
  row, justify between, padding) but the cursor: pointer + userSelect:
  none makes plain `<div>` simpler.
- Tabs (`.legend-tabs`, `.legend-tab`): three buttons with bottom-border
  accent. Plain `<button style={tabStyle, ...(active ? activeTabStyle :
  {})}>` — chrome too custom for SegmentedControl (filled pill mismatch).
- Content list (`.legend-content`): `<Panel direction="column"
  overflow="auto">` with maxHeight 250.
- `LegendRow`: native `<input type="checkbox">` + icon span + label
  span + native `<input type="text">` for description. Replace the
  text input with UIKit `Input size="sm" variant="ghost"`. Keep
  checkbox native (UIKit `Checkbox` is heavier than needed here — but
  consider migrating to `Checkbox` for consistency; verify by reading
  `uikit/Checkbox/Checkbox.tsx` during implementation and pick whichever
  is cleaner).
- `SelectionRadioRow`: native `<input type="radio">` + label. Same
  decision — likely keep native (`uikit/RadioGroup` is for grouped
  radios; standalone radio rows don't fit).
- "Search active" notice + Clear-search button:
  - `.legend-search-notice` → plain `<div style={...}>` with column flex.
  - `.legend-clear-search` → UIKit `Button size="sm" variant="ghost"`.

### Step 5 — Migrate `GraphDetailPanel.tsx` (largest)

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx`

Breakdown:

- `GraphDetailPanelRoot` (absolute top-right floating) → plain `<div
  style={rootStyle}>`. The panel-header opacity / cursor states
  (`.no-selection` / `.locked`) stay as inline-style ternaries.
- Header (`.panel-header`): plain `<div style={headerStyle, ...}>` with
  click handler. Chevron icon (`ChevronUpIcon`/`ChevronDownIcon`) stays.
- Panel body (`.panel-body`): plain `<div style={bodyStyle, width,
  height}>` — width/height come from `useState` resize state.
- Tabs (`.panel-tab`): three buttons. Same recommendation as legend —
  plain `<button style={tabStyle}>`. Disabled state is `anyDirty &&
  activeTab !== "info"` etc.
- Panel content (`.panel-content`, `.panel-content.no-pad`): plain
  `<div style={contentStyle}>`.
- Resizer (`.panel-resizer`): plain `<div style={resizerStyle}>` with
  SVG diagonal lines. Keep as-is.

Sub-components:

- **`InfoTab`**:
  - `.info-field` (column flex gap 2 marginBottom 8): UIKit `<Panel
    direction="column" gap="xs">`.
  - `.info-label`: `<Text size="sm" color="light">` (verify Text props).
  - `.info-input`: UIKit `Input size="sm"`. The `.info-input.error`
    red border is dropped — show `idError` as `<Text size="sm"
    color="error">` below the input. Visual delta accepted.
  - `.info-icons` row: UIKit `<Panel direction="row" align="center"
    gap="xs">`.
  - `.info-icon-btn` (square button, 24×24, with border accent on
    `.selected`/`.mixed`): UIKit `IconButton size="sm"` with the icon
    prop set to `<ShapeIcon>` or `<LevelIcon>`. Selected/mixed state via
    a custom data-attribute on the parent is not possible (UIKit forbids
    style/className escape hatches), so use UIKit IconButton `data-active`
    via standard prop pattern. **Verify whether UIKit IconButton
    accepts an `active` boolean prop or `data-active` via
    `...rest` spread.** If not, fall back to plain `<button
    style={btnStyle, ...(selected ? selectedStyle : {})}>`.

- **`MultiInfoTab`**: same patterns as InfoTab. The `.multi-info`
  italic warning note → `<Text size="sm" color="warning" italic>` or
  inline span.

- **`LinksTab`** / **`PropertiesTab`**:
  - `.links-tab` / `.properties-tab` (column flex, flex 1, overflow
    hidden): UIKit `<Panel direction="column" flex={1}
    overflow="hidden">`.
  - `.links-grid` / `.properties-grid` (same): same `<Panel>` wrapper.
  - `<AVGrid ... />` stays unchanged — AVGrid is the Phase 4 exception.
  - `.tab-action-row` (justify-end, gap 4, padding, border-top): UIKit
    `<Panel direction="row" justify="end" gap="xs" paddingX="sm"
    paddingY="xs" borderTop shrink={false}>`.
  - `.tab-apply-btn` (filled blue): UIKit `Button size="sm"
    variant="primary"`. Disabled state via `disabled` prop.
  - `.tab-cancel-btn` (ghost): UIKit `Button size="sm" variant="ghost"`.
  - `.properties-status` (italic warning text at bottom): plain `<div
    style={statusStyle}>` with `color.warning.text` + italic.
  - `data-cell.cell-error` / `data-cell.cell-mixed` — these are CSS
    class names applied via `onCellClass` callback on AVGrid cells.
    **AVGrid is not migrated** so this CSS must remain available. Move
    these two rules from `GraphDetailPanelRoot`'s nested CSS into a
    local `<style>` tag at the component root, or accept loss of the
    color styling. Recommend: local `<style>` tag with the two rules
    only (`color: color.error.text` / `color: color.warning.text`).

### Step 6 — Migrate `GraphView.tsx` (main file)

**File:** `src/renderer/editors/graph/GraphView.tsx`

This is the biggest migration. The `GraphViewRoot` styled definition is
~380 lines; nearly all of it disappears.

- Drop `import styled from "@emotion/styled"`.
- Drop `import { CircularProgress } from "../../components/basic/CircularProgress"`
  → `import { Spinner } from "../../uikit"`.
- Drop `import { highlightText } from "../../components/basic/useHighlightedText"`
  → `import { highlight } from "../../uikit/shared/highlight"`.
- Drop `import { Button } from "../../components/basic/Button"`
  → `import { IconButton } from "../../uikit"` (for the Draw/Copy
  toolbar buttons).
- Root: plain `<div ref={containerRef} style={rootStyle}
  onMouseDownCapture={...}>`. Inline-style constant: `display: flex,
  flexDirection: column, flex: 1 1 auto, overflow: hidden, position:
  relative`.
- Loading state (`.graph-loading`): plain `<div style={...}>` with
  `<Spinner />` centered. Background `color.graph.background`.
- Canvas (`.graph-canvas`): plain `<canvas style={...}>` keeps the
  same event handlers and ref callback.
- Empty hint (`.graph-empty-hint`): plain `<div style={emptyHintStyle}>`.
- **Toolbar (`.graph-toolbar`)**: floating panel with opacity-hover
  behavior, `.expanded`/`.has-search` modifier states, accent border on
  expanded. Use plain `<div style={toolbarStyle, ...}>` with React
  state `isHovered` toggling opacity (mirrors Notebook NoteItemView
  pattern). Same approach as legend panel in Step 4.
- **Toolbar row (`.graph-toolbar-row`)**: UIKit `<Panel direction="row"
  align="center" gap="xs" paddingX="xs" paddingY="xs">`.
- **Icon buttons (`.graph-icon-btn`)**: 6 buttons (Settings, Group,
  Refresh, ExpandAll, plus 2 in detail-panel context). UIKit
  `IconButton size="sm"`. Active state (`.active`) needs to render with
  accent border — verify whether IconButton exposes an `active` prop or
  use a wrapper with `data-active`; if neither, fall back to plain
  `<button style={...}>` with active styling.
  - The `.strikethrough` modifier (group toggle when grouping enabled)
    draws a 45° diagonal line via `::after` pseudo-element. Cannot
    replicate in inline styles without a styled wrapper. Recommend:
    keep the strikethrough by wrapping the IconButton's icon prop with
    a small `<span style={{ position: "relative" }}>` containing the
    icon + a 1px absolute-positioned line, OR accept loss of the
    strikethrough (use a separate "ungroup" icon glyph instead). Flag
    as visual concern.
- **Search input (`.graph-search-wrap` + `.graph-search-input` +
  `.graph-search-clear`)**: UIKit `Input size="sm" width={130}` with
  `endSlot={searchQuery ? <IconButton icon={<CloseIcon/>} size="sm"
  onClick={onSearchClear} /> : undefined}`. The `.has-search` color
  modifier (input text becomes accent-colored) is dropped — accept
  visual delta.
- **Search info / selection info spans (`.graph-search-info`,
  `.graph-selection-info`)**: plain `<span style={...}>` with
  `cursor: "pointer"` + `text-decoration: underline` on hover via
  React `isHovered` state (or accept loss of hover underline).
- **Tabs strip (`.toolbar-tabs` + `.toolbar-tab`)**: three buttons
  (Physics / Expansion / Results). Same approach as legend tabs / detail
  tabs — plain `<button style={tabStyle, ...(active ? activeStyle : {})}>`.
- **Search results panel (`.search-results`, `.search-result-row`,
  `.search-result-title`, `.search-result-prop`, `.search-result-prop-key`,
  `.search-no-results`)**: the inline `GraphSearchResults` helper
  becomes plain `<div style={...}>` with row state via React (hover via
  inline style on `<div onMouseEnter>` if needed; the
  `keyboard-selected` background is set via inline style based on `i
  === selectedIndex`).
- **Search status bar (`.search-status-bar`, `.search-reveal`)**: plain
  `<div style={statusBarStyle}>` with `<span
  style={revealStyle}>` for the reveal-hidden link.
- `editorToolbarRefLast` portal (`<Button type="icon" size="small">`
  for Draw/Copy): UIKit `IconButton size="sm"`.
- `editorFooterRefLast` portal (status hint + records count): unchanged
  — already plain DOM with inline style.
- Drop the `GraphViewRoot` styled.div definition entirely.

## Prerequisites

All UIKit additions needed by US-513 are bundled into
[US-519: UIKit primitive additions for Graph editor migration](../US-519-uikit-graph-editor-precursors/README.md).
US-519 must ship before US-513 implementation begins:

| Precursor (US-519 phase) | Used in |
|---|---|
| Phase 1 — UIKit `Slider` primitive | `GraphTuningSliders.tsx` |
| Phase 2 — UIKit `IconButton` `strikethrough` prop | `GraphView.tsx` group-toggle button |
| Phase 3 — UIKit `Text` `link` variant | `GraphView.tsx` (selection-info, reveal-hidden), `GraphTooltip.tsx` (tooltip-link) |

## Concerns

All concerns resolved.

- **C1 — `highlightText` Context vs prop-drilling.** Resolved per
  Notebook precedent. `GraphView.tsx` does not use the Context —
  `highlightText` is called directly in the local `GraphSearchResults`
  helper with `searchQuery` as a parameter. Just swap to the new
  `highlight()` pure function. No Context wiring needed.

- **C2 — UIKit Tooltip vs custom overlay.** Use plain portal `<div>`,
  not UIKit Tooltip. UIKit Tooltip is trigger-anchored hover chrome;
  `GraphTooltip` is a cursor-tracking overlay with viewport-edge
  clamping logic. Documented in Background section.

- **C3 — UIKit Slider availability.** Resolved by precursor: a new
  UIKit `Slider` primitive will be implemented before this task. See
  Prerequisites.

- **C4 — `MenuItem` type import in `GraphContextMenu.ts`.** That file
  currently imports from `components/overlay/PopupMenu`. UIKit exports
  `MenuItem` from `uikit/Menu`. Update the import to `import { MenuItem
  } from "../../uikit"`. Verify the structural shape matches; if it
  doesn't, that's a separate compatibility fix outside this task's
  scope and `GraphContextMenu.ts` is then a no-op for this task.

- **C5 — IconButton `active` state.** Already supported. Verified in
  `src/renderer/uikit/IconButton/IconButton.tsx`: the `active?:
  boolean` prop sets `data-active` and applies `color.icon.active`. Use
  directly for the Physics toolbar toggle and the level/shape buttons
  in `InfoTab` / `MultiInfoTab`.

- **C6 — Group-button strikethrough.** Resolved by precursor: a new
  `strikethrough` boolean prop on UIKit `IconButton` will render a 45°
  diagonal line overlay when true. See Prerequisites.

- **C7 — AVGrid cell-class color rules (`data-cell.cell-error`,
  `.cell-mixed`).** Resolved by wrapping UIKit `Panel` with Emotion in
  `GraphDetailPanel.tsx`:
  ```tsx
  const GraphDetailRoot = styled(Panel)({
      "& .data-cell.cell-error": { color: color.error.text },
      "& .data-cell.cell-mixed": { color: color.warning.text },
  });
  ```
  This is a documented exception to Rule 7's
  "no `@emotion/styled` outside UIKit" rule, justified by the need to
  ship CSS rules into AVGrid (an un-migrated component) without
  inventing a `<style>` tag. The exception is limited to the root
  wrapper of `GraphDetailPanel.tsx`. When AVGrid is migrated later in
  EPIC-025, the wrapper can be replaced with a plain `<Panel>`.

- **C8 — Hover underline on text spans.** Resolved by precursor: a new
  `link` variant on UIKit `Text` will render link-styled text with
  hover-underline behavior. See Prerequisites.

- **C9 — Editor exception in Rule 7.** `src/renderer/editors/` is NOT
  the `src/renderer/ui/` chrome exception. Editors must use UIKit
  primitives strictly. Plain `<div style={...}>` is permitted
  (Notebook precedent). The one `styled(Panel)` wrapper in
  `GraphDetailPanel.tsx` for AVGrid CSS pass-through (C7) is a
  documented exception, not a precedent for general Emotion use in
  editors.

## Test surface (manual smoke)

- Open a graph file (e.g. `*.fg.json`): nodes/edges render, no console
  errors.
- Loading state: brief spinner appears before canvas paints.
- Hover a node: tooltip appears with title / id / props. Move cursor
  to viewport edges — tooltip flips to stay visible. Click copy button
  → markdown copied. Click open button → new page opens.
- Click a node: detail panel populates. Toggle Info / Properties / Links
  tabs. Edit ID with an existing value → error message appears under
  ID input. Edit level / shape buttons toggle visually. Resize the
  panel by dragging bottom-left corner.
- Select multiple nodes: detail panel shows "N nodes selected" header
  and Multi info tab.
- Toolbar: hover causes opacity to go to 1. Click Settings → tabs
  appear → Physics tab shows tuning sliders, dragging them updates the
  graph in real time, Reset button restores defaults. Expansion tab
  shows Root Node Select (verify Select dropdown opens and filters by
  typing), Expand Depth / Max Visible numeric inputs.
- Search: type in search input → Results tab activates, list shows
  matches with bold matches in titles. Arrow keys navigate, Enter
  selects, Esc clears. `Ctrl+F` focuses the input. `Ctrl+A` selects
  all nodes.
- Group toggle button: visual indicator (strikethrough or alternative)
  reflects grouping state.
- Legend panel (bottom-left): expand → three tabs (Selection / Level /
  Shape). Click checkboxes → graph highlighting updates. Type
  descriptions → persist after page reload. Selection radio rows
  change highlight set.
- Editor toolbar (top of window, portal): Draw button opens drawing
  page with PNG export. Copy button copies PNG to clipboard.
- Editor footer: status hint + records count visible.

## Acceptance criteria

- [ ] No `@emotion/styled` import in `GraphView.tsx`,
      `GraphTooltip.tsx`, `GraphExpansionSettings.tsx`,
      `GraphTuningSliders.tsx`, `GraphLegendPanel.tsx`.
- [ ] `GraphDetailPanel.tsx` may retain a single `styled(Panel)`
      wrapper for AVGrid cell-class CSS pass-through (per C7); no other
      Emotion usage in the file.
- [ ] No imports from `components/basic/`, `components/form/`,
      `components/layout/`, `components/overlay/` in any in-scope file
      (AVGrid retained — explicitly out of Phase 4 scope).
- [ ] `npm run lint` clean; no new TypeScript errors via `npx tsc
      --noEmit`.
- [ ] All test-surface steps above pass in `npm start`.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred-review model.

## Files Changed (planned)

| File | Change |
|---|---|
| `src/renderer/editors/graph/GraphView.tsx` | Drop `GraphViewRoot` styled definition (~380 lines of CSS); migrate to inline styles + UIKit Panel/IconButton/Input/Spinner; swap `highlightText` → `highlight()`; swap `Button type="icon"` → `IconButton`. |
| `src/renderer/editors/graph/GraphTooltip.tsx` | Drop `GraphTooltipRoot`; inline styles on portal-rendered `<div>`; copy/open buttons → UIKit `IconButton`. |
| `src/renderer/editors/graph/GraphExpansionSettings.tsx` | Drop `GraphExpansionSettingsRoot`; UIKit Panel + Input + Select (replacing ComboSelect). |
| `src/renderer/editors/graph/GraphDetailPanel.tsx` | Drop `GraphDetailPanelRoot`; UIKit Panel + Input + IconButton + Button; local `<style>` tag for AVGrid cell-class color rules. |
| `src/renderer/editors/graph/GraphTuningSliders.tsx` | Drop `GraphTuningSlidersRoot`; UIKit Panel wrapper + native `<input type="range">` with inline style + UIKit Button (Reset). |
| `src/renderer/editors/graph/GraphLegendPanel.tsx` | Added inline styles for floating chrome (previously inherited from `GraphViewRoot`); UIKit Input for description fields; keep native checkbox/radio. |
| `src/renderer/editors/graph/GraphContextMenu.ts` | Update `MenuItem` import from `components/overlay/PopupMenu` to `uikit/Menu` (one-line change; verify shape compat). |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference implementation: [US-512 Notebook editor migration](../US-512-notebook-editor-migration/README.md) (commit `c2c554b`)
- UIKit authoring rules: [src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md)
