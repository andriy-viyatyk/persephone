# US-520: UIKit primitive additions for Video / Audio editor migration

## Status

**Plan ready for review** — not yet implemented. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 UIKit primitive infrastructure.

Bundled precursor for [US-514](../US-514-video-audio-player-migration/README.md)
following the same pattern as
[US-519](../US-519-uikit-graph-editor-precursors/README.md) (precursor for
US-513 Graph editor): ship the UIKit primitive extensions alone first, then
US-514 consumes them.

## Goal

Add two extensions to existing UIKit primitives so US-514 can migrate the
audio seek-bar and the AudioVisualizer effect-switcher without per-screen
escape hatches:

1. **Phase 1 — `Slider.showProgress`** — auto-fill the played portion of the
   slider track using `value`/`min`/`max`. Required by US-514 C1 (audio
   seek-bar gradient).
2. **Phase 2 — `IconButton.variant="chip"`** — bordered + backgrounded chip
   look for toggle buttons where the "active" state changes border,
   background, and icon color (not just icon color). Required by US-514 C2
   (AudioVisualizer effect-switcher).

After this task, US-514 can consume both via standard UIKit props with no
inline-style chip helpers, no module-scoped `<style>` tag for the seek-bar
gradient, and no raw `<input type="range">` in the audio editor.

## Background

### Phase 1 — Slider.showProgress

**Current Slider (US-519, `src/renderer/uikit/Slider/Slider.tsx`):**
- Generic range input: `value`, `min`, `max`, `step`, `size`, `disabled`,
  `width`.
- Track styled uniformly via
  `&::-webkit-slider-runnable-track { background: color.border.default }`
  and the Firefox equivalent.
- No notion of "progress" — the played portion is not visually
  distinguished from the upcoming portion.

**Used today by:**
- Graph editor tuning sliders (US-513) — generic value tuning, no progress
  semantic.

**Needed by US-514:**
- Audio seek-bar — must show **how much of the track has played** as a
  filled portion of the track (today implemented as inline
  `background: linear-gradient(to right, active ${pct}%, default ${pct}%)`).

### Phase 2 — IconButton.variant="chip"

**Current IconButton (`src/renderer/uikit/IconButton/IconButton.tsx`):**
- `active?: boolean` — when true, icon color becomes `color.icon.active`
  (theme blue tint). Hover/press feedback is suppressed in favor of the
  active color.
- No background or border styling — the IconButton is a transparent control
  whose only visible chrome is the icon itself.

**Used today by:**
- Toolbar toggles in many editors — single-color tint on active is the
  desired feedback.

**Needed by US-514:**
- AudioVisualizer effect-switcher (3 buttons: Bars, Circular, None) where
  the active state should look like a **chip**: visible border,
  contrasting background, and yellow icon. The existing styled.button
  `EffectButton` (`src/renderer/editors/video/AudioVisualizer.tsx:124-141`)
  encodes the exact rules:
  - Rest: `border: color.border.default`, `background: color.background.dark`,
    `color: color.icon.light`.
  - Hover: `border: color.border.active`, `color: color.misc.yellow`
    (background unchanged).
  - Active: `border: color.border.active`,
    `background: color.background.light`, `color: color.misc.yellow`.

## Implementation plan

Two phases. Each ships independently and produces a new lint/tsc baseline before
the next phase starts.

### Phase 1 — `Slider.showProgress`

**Files to modify:**
- `src/renderer/uikit/Slider/Slider.tsx`

**Steps:**

1. Add `showProgress?: boolean` to `SliderProps`:
   ```ts
   /**
    * Fill the played portion of the track with the active border color.
    * Computed from `(value - min) / (max - min)`. Default: false (uniform track).
    * Useful for media seek-bars where the elapsed portion should be visually
    * distinct from the remaining portion.
    */
   showProgress?: boolean;
   ```

2. Update the styled root to read a CSS custom property for the track
   background, with a sensible default fallback:
   ```ts
   "&::-webkit-slider-runnable-track": {
       height: 4,
       borderRadius: radius.xs,
       background: `var(--slider-track-bg, ${color.border.default})`,
   },
   "&::-moz-range-track": {
       height: 4,
       borderRadius: radius.xs,
       background: `var(--slider-track-bg, ${color.border.default})`,
   },
   ```
   The `var(...)` indirection lets the component conditionally inject a
   gradient via inline `style` on the root input — pseudo-elements cannot
   read inline-style directly, but they can read a custom property set on
   the host.

3. In the component body, compute the progress gradient when
   `showProgress` is set:
   ```ts
   const trackStyle = React.useMemo<React.CSSProperties | undefined>(() => {
       if (!showProgress) return undefined;
       const range = max - min;
       const pct = range > 0 ? ((value - min) / range) * 100 : 0;
       return {
           "--slider-track-bg": `linear-gradient(to right, ${color.border.active} ${pct}%, ${color.border.default} ${pct}%)`,
       } as React.CSSProperties;
   }, [showProgress, value, min, max]);
   ```

4. Merge `trackStyle` with the existing `width` style on the root:
   ```ts
   const rootStyle: React.CSSProperties | undefined = (() => {
       if (!trackStyle && width === undefined) return undefined;
       return {
           ...(trackStyle ?? {}),
           ...(width !== undefined ? { width } : {}),
       };
   })();
   ```
   Apply via `style={rootStyle}` on the root.

5. Document the new prop in the JSDoc and add `data-show-progress` (mirror
   pattern of other Slider data-* attributes) for DOM inspection:
   ```tsx
   data-show-progress={showProgress || undefined}
   ```

**Storybook:**
- Update `src/renderer/editors/storybook/sliderStory.tsx` (or whatever file
  hosts the Slider story) to add a `showProgress` toggle variant. Confirm in
  Storybook that progress fill renders correctly across slide actions.

### Phase 2 — `IconButton.variant="chip"`

**Files to modify:**
- `src/renderer/uikit/IconButton/IconButton.tsx`

**Steps:**

1. Add `variant?: "default" | "chip"` to `IconButtonProps`:
   ```ts
   /**
    * Visual variant. `"default"` (default) renders a transparent control whose only
    * visible chrome is the icon itself; `active` tints the icon. `"chip"` renders
    * a bordered + backgrounded chip: hover changes the border to active blue and the
    * icon to yellow; the `active` state additionally fills the background with
    * `color.background.light`. Use `"chip"` for toggle groups where the selected
    * member should read as a distinct surface (e.g. effect / mode pickers).
    */
   variant?: "default" | "chip";
   ```

2. Add chip-variant rules to the styled root. Note that chip and the
   strikethrough/hideUntilParentHover features should compose, so do not
   guard chip behind `&:not([data-strikethrough])` or similar.
   ```ts
   '&[data-variant="chip"]': {
       border: `1px solid ${color.border.default}`,
       backgroundColor: color.background.dark,
   },
   '&[data-variant="chip"]:hover': {
       borderColor: color.border.active,
       color: color.misc.yellow,
   },
   '&[data-variant="chip"][data-active]': {
       borderColor: color.border.active,
       backgroundColor: color.background.light,
       color: color.misc.yellow,
   },
   ```
   The chip variant overrides the default IconButton hover/active rules
   (`color: color.icon.default` on hover, `color: color.icon.active` on
   active) via attribute-selector specificity. **Verify** in
   implementation that the chip rules render correctly — attribute
   selectors `[data-variant="chip"][data-active]` and `[data-active]` have
   the same specificity, so source-order matters. Place chip rules **after**
   the base rules.

3. Emit `data-variant` on the root and forward the prop:
   ```tsx
   data-variant={variant}  // already standard UIKit data-attr pattern
   ```

4. Default `variant = "default"` in the component signature so all existing
   consumers (Graph editor toolbar, Settings page, etc.) continue rendering
   unchanged.

**Storybook:**
- Update `src/renderer/editors/storybook/iconButtonStory.tsx` to add a
  variant toggle. Confirm in Storybook that chip + active + strikethrough +
  hideUntilParentHover all compose correctly.

## Concerns / Open questions

### Q1 — Slider track background and CSS custom property fallback

`var(--slider-track-bg, ${color.border.default})` provides a fallback so
existing Slider consumers (Graph tuning sliders) render unchanged. Verify in
implementation that the CSS variable indirection does not break the existing
look — visually compare US-513 Graph tuning panel before/after.

### Q2 — `IconButton.variant="chip"` color tokens

The chip variant hard-codes `color.misc.yellow` for the hover/active icon
color, mirroring the existing EffectButton style. Alternative: parameterize
with an `accentColor` prop. **Recommendation: keep `color.misc.yellow`
hard-coded for now** — only one consumer planned, and parameterization can
be added later without breaking the API. Document the choice in the component's
JSDoc.

### Q3 — Slider showProgress with reversed track

If `min > max` (negative-step slider — extremely rare), the progress
calculation underflows. Not a real use case today; `max - min > 0` check
guards against division by zero. No further handling needed.

## Acceptance criteria

- [ ] `npm run lint` baseline maintained (no new errors/warnings from
      `src/renderer/uikit/Slider/Slider.tsx` or
      `src/renderer/uikit/IconButton/IconButton.tsx`).
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Storybook renders both new variants (`Slider showProgress`,
      `IconButton variant="chip"` in default / hover / active / disabled /
      strikethrough / hideUntilParentHover states).
- [ ] Existing Slider consumers (US-513 Graph tuning sliders) render
      identically to before.
- [ ] Existing IconButton consumers (toolbars across editors, sidebar,
      settings) render identically — only `variant="chip"` opts into the new
      look.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Slider/Slider.tsx` | Add `showProgress?: boolean` prop; route track background through `var(--slider-track-bg, color.border.default)` so the gradient can be set via inline custom property on the host element. |
| `src/renderer/uikit/IconButton/IconButton.tsx` | Add `variant?: "default" \| "chip"` prop; add chip-variant attribute selector rules (border + dark background at rest, yellow + active border on hover, yellow + light background on active). |
| `src/renderer/editors/storybook/sliderStory.tsx` (or equivalent) | Add `showProgress` variant. |
| `src/renderer/editors/storybook/iconButtonStory.tsx` (or equivalent) | Add chip variant. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-514: Video / Audio Player editor — UIKit migration](../US-514-video-audio-player-migration/README.md)
- Pattern reference: [US-519: UIKit primitive additions for Graph editor migration](../US-519-uikit-graph-editor-precursors/README.md)
