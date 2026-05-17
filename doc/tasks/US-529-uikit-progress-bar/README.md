# US-529: UIKit ProgressBar primitive — inline linear progress

## Status

**Plan ready for review.** Precursor for [US-524](../US-524-log-view-editor-migration/README.md) (LogView editor — UIKit migration). LogView's `output.progress` log entries render an inline linear progress bar; UIKit does not yet expose one, so this task adds it.

## Goal

Add a `ProgressBar` primitive to `src/renderer/uikit/` that renders an inline linear progress indicator. It must support:

- **Determinate mode** — `value` + `max` drive a filled bar (0–100 %).
- **Indeterminate mode** — pulsing / sliding fill when `value` is absent.
- **Completed mode** — distinct fill colour (green) when work has finished.

Unlike the existing UIKit `Progress` (screen-blocking modal overlay) and `Slider` (interactive `<input type="range">`), this primitive is a non-interactive status indicator suitable for embedding in log streams, status bars, and future download / upload UIs.

## Background

### Current state in UIKit

`uikit/Progress/` exposes a global overlay (`ProgressOverlay`, `progressState`, `createProgress`, `showProgress`, `notifyProgress`, `addScreenLock`, `removeScreenLock`). It renders a centered pill with `Spinner` + label and is meant for modal-style "app is busy" feedback. It does **not** expose an inline progress-bar component.

`uikit/Slider/` is an `<input type="range">` wrapper (`SliderProps.showProgress` colours the played portion of the track). It is an interactive control — wrong semantics for a status indicator.

### Inline progress bar in the codebase

The legacy implementation lives in `src/renderer/editors/log-view/items/ProgressOutputView.tsx`:

```ts
// styled chrome
"& .progress-track": {
    width: 160,
    height: 6,
    borderRadius: 3,
    background: color.background.dark,
    overflow: "hidden",
},
"& .progress-fill": {
    height: "100%",
    borderRadius: 3,
    background: color.misc.blue,
    transition: "width 0.2s ease",
},
"& .progress-fill.completed": {
    background: color.misc.green,
},
```

Render logic (`ProgressOutputView`):

- If `value == null && !completed` → indeterminate (renders a `CircularProgress` spinner inline next to the label, **no bar**).
- Otherwise → bar with `width = completed ? 100 : (value / max) * 100`%.

The new UIKit primitive should render a **linear bar** in all modes (including indeterminate, where the fill animates), so the LogView migration becomes one component without a sibling spinner.

### Reusability

This primitive will replace the inline implementation in LogView and is intended to be reusable by future surfaces — download progress in browser editor, archive extraction progress, script batch progress, etc. No other current code path will be wired in this task.

## Implementation plan

### 1. Folder + file scaffolding

Create:

- `src/renderer/uikit/ProgressBar/ProgressBar.tsx` — view component.
- `src/renderer/uikit/ProgressBar/ProgressBar.story.tsx` — Storybook stories (determinate, indeterminate, completed, custom width).
- `src/renderer/uikit/ProgressBar/index.ts` — barrel export.

Follow the UIKit file template in `src/renderer/uikit/CLAUDE.md`: one Emotion `styled` per logical DOM element, `data-type="progress-bar"`, design tokens from `tokens.ts`, colours from `theme/color.ts`. Component stays as a plain function component (small enough — does not meet Rule 8 model-view threshold).

### 2. Component props

```tsx
export interface ProgressBarProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Optional debug label emitted as `data-name` on the root element. */
    name?: string;

    /** Current value. When undefined and `completed` is false, the bar is indeterminate. */
    value?: number;
    /** Maximum value. Default: 100. */
    max?: number;
    /** Mark the work as finished. Renders a full bar in the success colour. */
    completed?: boolean;

    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
    /** Track height in px. Default: 6. */
    height?: number;

    /** Visual variant. Default: "default". */
    variant?: "default" | "success" | "warning" | "danger";

    /** ARIA label for accessibility. Default: "Progress". */
    "aria-label"?: string;
}
```

### 3. Visual spec

- **Track**: `background: color.background.dark`, `border-radius: radius.xs` (3 px), `overflow: hidden`.
- **Determinate fill**: `background: color.misc.blue` (or `variant`-mapped colour), `transition: width 0.2s ease`, width computed from `value / max` clamped to `[0, 100]`%.
- **Completed fill**: `background: color.misc.green`, width 100 %. `completed` overrides `value`/`max`.
- **Indeterminate fill**: 30 %-wide segment animated left→right via CSS `keyframes`, infinite, 1.4 s linear. No `transition` on width.
- **Default size**: width = 100 % (fills parent), height = 6 px.

### 4. Data attributes (Rule 1)

- `data-type="progress-bar"` — required.
- `data-name={name}` — when present.
- `data-state="indeterminate" | "determinate" | "completed"` — drives the fill style selector.
- `data-variant={variant}` — drives the fill colour.

ARIA: `role="progressbar"`, `aria-valuemin={0}`, `aria-valuemax={max}`, `aria-valuenow={value}` in determinate mode; only `aria-busy` in indeterminate mode.

### 5. Export from `uikit/index.ts`

Add under the "Bootstrap components" block:

```ts
export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";
```

### 6. Storybook stories

Cover:

- Determinate at 0 %, 50 %, 100 %.
- Indeterminate (no `value`).
- Completed.
- All four variants (default / success / warning / danger).
- Custom width (e.g. 200 px) and custom height (e.g. 10 px).
- Side-by-side row of progress bars with labels (composition demo).

## Concerns / Open questions

### Variant colour for "completed"

`completed` and `variant="success"` would visually collide — both render a green fill. Decision: `completed` takes precedence over `variant` (the indicator's whole purpose is to communicate "work done", regardless of variant). Storybook docs should call this out.

### Indeterminate animation

CSS `keyframes` animations sometimes flicker when the component mounts during virtualized row creation (LogView uses RenderFlexGrid). The animation must use `transform: translateX(...)` (compositor-only) rather than `left:` / `right:` to avoid layout thrash.

### No "label" prop

Other progress indicators (the modal `Progress`) bundle a label. ProgressBar deliberately does **not** — labels are layout-level concerns. Callers compose `<Panel direction="column" gap="xs"><Text>Label</Text><ProgressBar … /></Panel>`. Keeps the primitive single-purpose and matches Slider's approach.

### No "height" preset scale

Other primitives use `size="sm"|"md"|"lg"`. ProgressBar's height is a raw number because callers genuinely vary it (6 px for a log-stream bar, 4 px for a thin status bar, 12 px for a download dialog). A preset scale would be premature here.

## Acceptance criteria

- `ProgressBar` component exported from `src/renderer/uikit/index.ts` alongside other UIKit primitives.
- All four modes (determinate / indeterminate / completed / variant-coloured) render correctly in Storybook.
- `data-type="progress-bar"` on the root; `data-state` reflects the current mode; `data-name` honoured.
- ARIA attributes correct in both modes (`role="progressbar"` with `aria-valuenow` when determinate; `aria-busy="true"` when indeterminate).
- No `style` or `className` props accepted (per Rule 7 — `Omit<HTMLAttributes, "style" | "className">`).
- `npm run lint` baseline unchanged.
- `npx tsc --noEmit` baseline unchanged.
- No code in `src/renderer/` is migrated to use `ProgressBar` in this task — that is done in [US-524](../US-524-log-view-editor-migration/README.md).

This task does NOT run `/review`, `/document`, or `/userdoc` — they run at EPIC-025 close per the deferred-review model.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/ProgressBar/ProgressBar.tsx` | **new** — component implementation |
| `src/renderer/uikit/ProgressBar/ProgressBar.story.tsx` | **new** — Storybook stories |
| `src/renderer/uikit/ProgressBar/index.ts` | **new** — barrel export |
| `src/renderer/uikit/index.ts` | **edit** — add `ProgressBar` + `ProgressBarProps` exports |

### Files that need NO changes in this task

- `src/renderer/uikit/Progress/*` — overlay primitive stays as-is. Inline `ProgressBar` is a separate concept.
- `src/renderer/uikit/Slider/*` — interactive range input, unrelated.
- `src/renderer/editors/log-view/items/ProgressOutputView.tsx` — migrated in US-524, not here.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Consumed by: [US-524](../US-524-log-view-editor-migration/README.md) (LogView editor — UIKit migration)
- Related primitives: `Progress` (overlay), `Slider` (interactive), `Spinner` (indeterminate icon)
