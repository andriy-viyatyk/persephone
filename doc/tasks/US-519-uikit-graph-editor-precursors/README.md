# US-519: UIKit primitive additions for Graph editor migration

## Status

**Plan ready for review.** Precursor to [US-513 Graph editor — UIKit
migration](../US-513-graph-editor-migration/README.md). Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 UIKit primitive
infrastructure.

## Goal

Ship three UIKit additions needed by US-513:

1. New UIKit **`Slider`** primitive — for `GraphTuningSliders`.
2. New UIKit **`IconButton.strikethrough`** prop — for the
   group-toggle button's diagonal-line indicator.
3. New UIKit **`Text` `link` variant** — for hover-underline link
   styling on clickable text spans.

Each addition is small and self-contained. Bundling them lets US-513
unblock with a single dependency rather than three.

## Background

US-513 is the next per-screen migration in Phase 4. During US-513
planning, three UIKit gaps were identified (see
[US-513 Concerns C3, C6, C8](../US-513-graph-editor-migration/README.md#concerns)).
Rather than work around them with inline DOM or local pseudo-elements,
the cleaner path is to extend UIKit so future screens benefit. All
three additions follow established UIKit conventions:

- Rule 1 (`data-*` for state attributes).
- Rule 2 (controlled value via `value` + `onChange`).
- Rule 7 (no `style`/`className` escape hatches; props only).
- Tokens from `uikit/tokens.ts` for spacing / size / radius / fontSize.
- Colors from `theme/color`.

The Slider implementation is informed by the existing
`GraphTuningSliders.tsx` (4px track, 12px round thumb) and the
similar pattern used in standard form controls (centered thumb on a
1-2px track is the de-facto baseline).

## Phase 1 — UIKit `Slider` primitive

### Files

- **New:** `src/renderer/uikit/Slider/Slider.tsx`
- **New:** `src/renderer/uikit/Slider/Slider.story.tsx`
- **New:** `src/renderer/uikit/Slider/index.ts`
- **Edit:** `src/renderer/uikit/index.ts` — export `Slider` and
  `SliderProps`.

### Prop surface

```ts
export interface SliderProps
    extends Omit<
        React.InputHTMLAttributes<HTMLInputElement>,
        "value" | "onChange" | "min" | "max" | "step" | "type" | "size" |
        "style" | "className"
    > {
    /** Current value. */
    value: number;
    /** Change handler — receives the parsed number directly. */
    onChange: (value: number) => void;
    /** Minimum value. */
    min: number;
    /** Maximum value. */
    max: number;
    /** Step. Default: 1. */
    step?: number;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    /** Disabled state. */
    disabled?: boolean;
    /** Fixed width — number → px, string passes through. Default: 100%. */
    width?: number | string;
}
```

### Implementation

```tsx
const Root = styled.input(
    {
        appearance: "none",
        background: "transparent",
        outline: "none",
        cursor: "pointer",
        margin: 0,
        flex: 1,
        minWidth: 0,

        // Webkit track + thumb
        "&::-webkit-slider-runnable-track": {
            height: 4,
            borderRadius: radius.xs,
            background: color.border.default,
        },
        "&::-webkit-slider-thumb": {
            appearance: "none",
            width: 12,
            height: 12,
            marginTop: -4,
            borderRadius: radius.full,
            background: color.border.active,
            cursor: "pointer",
        },

        // Firefox track + thumb
        "&::-moz-range-track": {
            height: 4,
            borderRadius: radius.xs,
            background: color.border.default,
        },
        "&::-moz-range-thumb": {
            width: 12,
            height: 12,
            border: "none",
            borderRadius: radius.full,
            background: color.border.active,
            cursor: "pointer",
        },

        '&[data-size="sm"]': {
            height: height.controlSm,
        },
        '&[data-size="md"]': {
            height: height.controlMd,
        },

        "&[data-disabled]": {
            opacity: 0.4,
            pointerEvents: "none",
        },
    },
    { label: "Slider" },
);

export function Slider({
    value, onChange, min, max, step = 1, size = "md", disabled, width,
    ...rest
}: SliderProps) {
    return (
        <Root
            data-type="slider"
            data-size={size}
            data-disabled={disabled || undefined}
            type="range"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            style={width !== undefined ? { width } : undefined}
            {...rest}
        />
    );
}
```

Notes:
- `style={width}` is a UIKit-internal usage of inline style (Slider is
  inside the `uikit/` folder where inline style is permitted on
  primitive HTML elements). Consumers cannot pass `style=` because
  `SliderProps` omits it from the HTMLAttributes union.
- Track + thumb colors come from `color.border.default` / `color.border.active`
  — same tokens used by other UIKit controls (Input border focus, etc.).
- No value display: that's a sibling concern (callers add their own
  `<Text>` showing the value).

### Story

`Slider.story.tsx` showcases:
- Default size, range 0–100
- Size `"sm"`
- Disabled
- Custom step (e.g. 0.05 for fine-grained controls)
- Wired to `useState` to demonstrate controlled value flow

## Phase 2 — UIKit `IconButton.strikethrough` prop

### File

- **Edit:** `src/renderer/uikit/IconButton/IconButton.tsx`
- **Edit:** `src/renderer/uikit/IconButton/IconButton.story.tsx` —
  add example.

### Prop addition

```ts
export interface IconButtonProps extends ... {
    // ...existing props
    /**
     * Render a 45° diagonal line over the icon to indicate a toggled-off
     * or disabled-feature state. Visible regardless of hover/active state.
     */
    strikethrough?: boolean;
}
```

### Styled change

Add a `::after` pseudo-element that draws the diagonal line, gated on
`data-strikethrough`:

```ts
const Root = styled.button(
    {
        // ...existing styles
        position: "relative",        // already implicit; make explicit for ::after
        "&[data-strikethrough]::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: spacing.xs,
            right: spacing.xs,
            height: 1,
            background: "currentColor",
            transform: "rotate(-45deg)",
            pointerEvents: "none",
        },
    },
    { label: "IconButton" },
);
```

### Component change

```tsx
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({ icon, size = "md", active, disabled, title,
        hideUntilParentHover, strikethrough, ...rest }, ref) {
        // ...existing
        return (
            <Root
                // ...existing data-* attributes
                data-strikethrough={strikethrough || undefined}
                // ...
            >
                <span data-part="icon">{icon}</span>
            </Root>
        );
    },
);
```

Notes:
- Line uses `currentColor` so it inherits whatever icon color is
  active (default / hover / `data-active` / `data-disabled`). No
  separate color logic needed.
- `pointerEvents: "none"` so the overlay doesn't intercept clicks.
- Width spans `left: spacing.xs` to `right: spacing.xs` — same as
  the original `.strikethrough` rule in `GraphView.tsx`.

### Story

Add a row to `IconButton.story.tsx` showing:
- Plain IconButton
- IconButton with `strikethrough`
- IconButton with both `active` and `strikethrough` (line color follows
  the active color via `currentColor`)

## Phase 3 — UIKit `Text` `link` variant

### File

- **Edit:** `src/renderer/uikit/Text/Text.tsx`
- **Edit:** `src/renderer/uikit/Text/Text.story.tsx` — add example.

### Type change

```ts
export type TextVariant = "default" | "uppercased" | "link";
```

### Styled change

Add rules for `data-variant="link"`:

```ts
const Root = styled.span(
    {
        // ...existing rules
        '&[data-variant="link"]': {
            color: color.primary.text,
            cursor: "pointer",
            textDecoration: "none",
        },
        '&[data-variant="link"]:hover': {
            textDecoration: "underline",
        },
    },
    { label: "Text" },
);
```

### Component change

No body change needed — `data-variant` is already wired from the
existing `variant` prop. Only the type and styled rules change.

### Story

Add to `Text.story.tsx`:
- A `<Text variant="link" onClick={...}>open in new tab</Text>` example
- Demonstrate cursor + hover-underline behavior

### Notes

- `link` is exclusive with `uppercased` (single `variant` prop). If a
  future use case needs uppercased + link, a follow-up can split the
  variant into orthogonal props. Not needed now.
- Click handling: callers attach `onClick={...}`. Text already spreads
  HTMLAttributes via `...rest`, so this works without changes.
- The `link` variant does not render `<a>` — it stays a `<span>`. For
  navigation-style links use `<a>` directly (out of scope for Text).

## Phases ordering

Phases are independent and can ship in any order. Recommend Phase 1
(Slider) first as it's the largest; Phases 2 and 3 are single-prop
extensions that can ride alongside.

The implementation can be a single commit covering all three phases,
or three commits — caller preference. Either is fine; this is a small
bundle.

## Concerns

None. All design decisions resolved during US-513 planning.

## Test surface (manual smoke)

### Phase 1 — Slider

- Open Storybook → Slider story.
- Drag thumb across range: value updates smoothly.
- Verify `size="sm"` is visibly shorter than `size="md"`.
- `disabled` state: thumb does not move, opacity reduced.
- Resize browser window: width-100% Slider stretches; fixed `width=200`
  Slider stays at 200px.

### Phase 2 — IconButton strikethrough

- Open Storybook → IconButton story → strikethrough row.
- Verify the 45° diagonal line is visible over the icon.
- Hover the button: line color follows the hover icon color (via
  `currentColor`).
- Combined with `active`: line color follows the active color.
- Click: button still fires onClick (line does not block events).

### Phase 3 — Text link variant

- Open Storybook → Text story → link variant.
- Verify cursor is pointer over the link text.
- Hover: underline appears.
- Hover off: underline disappears.
- Verify `onClick` fires when clicked.

## Acceptance criteria

- [ ] `src/renderer/uikit/Slider/Slider.tsx` exists with the prop
      surface above.
- [ ] `src/renderer/uikit/Slider/index.ts` re-exports `Slider` and
      `SliderProps`.
- [ ] `src/renderer/uikit/index.ts` exports `Slider` and `SliderProps`.
- [ ] `IconButton` accepts `strikethrough?: boolean`; storybook
      example added.
- [ ] `Text` accepts `variant="link"`; storybook example added.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Storybook smoke tests above pass.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the epic's deferred-review model.

## Files Changed (planned)

| File | Change |
|---|---|
| `src/renderer/uikit/Slider/Slider.tsx` | NEW — Slider primitive |
| `src/renderer/uikit/Slider/Slider.story.tsx` | NEW — story examples |
| `src/renderer/uikit/Slider/index.ts` | NEW — re-exports |
| `src/renderer/uikit/index.ts` | Add Slider + SliderProps to public exports |
| `src/renderer/uikit/IconButton/IconButton.tsx` | Add `strikethrough` prop + `::after` styled rule |
| `src/renderer/uikit/IconButton/IconButton.story.tsx` | Add strikethrough example |
| `src/renderer/uikit/Text/Text.tsx` | Add `"link"` to TextVariant + styled rules |
| `src/renderer/uikit/Text/Text.story.tsx` | Add link variant example |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure (unblocks US-513)
- Unblocks: [US-513 Graph editor — UIKit migration](../US-513-graph-editor-migration/README.md)
- UIKit authoring rules: [src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md)
