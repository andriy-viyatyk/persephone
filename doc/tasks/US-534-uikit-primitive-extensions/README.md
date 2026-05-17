# US-534: UIKit primitive extensions — Text free-form color, Textarea width/flex, Panel `dimmed`

## Status

**Implemented — awaiting user testing + epic-close review** — part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 UIKit primitive infrastructure.
Primitive-only task; consumed by
[US-501](../US-501-rest-client-migration/README.md) and any future migration
that runs into the same inline-style needs (HTTP method colour, response
status colour, sized inline editors, dimmed-but-clickable rows). `tsc` and
`lint` baselines unchanged.

## Goal

Add three small, additive prop extensions to existing UIKit primitives so
per-screen migrations stop reaching for `style={…}` escape hatches on UIKit
components:

1. `Text.color` accepts any CSS colour string (theme token) in addition to the
   named-token enum.
2. `Textarea` exposes `width` / `minWidth` / `maxWidth` / `flex` (mirroring
   `Panel`'s sizing surface and `Input`'s `flex` resolver).
3. `Panel` adds `dimmed?: boolean` — opacity only, no `pointer-events: none`,
   so dimmed rows still receive clicks (re-enable checkbox).

All three were captured as concerns in US-501. Shipping them as a single
precursor keeps US-501 a pure editor-migration task and keeps user testing
scoped per the EPIC-025 primitive-with-retrofit pattern (memory
`feedback_uikit_primitive_with_retrofit.md`).

## Background

### Why a free-form `Text.color`

Two RestClient call sites paint text in a colour derived from runtime data:

- `RequestBuilder` URL bar method label — colour comes from
  `METHOD_COLORS[request.method]` (`universalColors.http.method.*`).
- `RestClientEditor` response status line — colour comes from
  `getStatusColor(response.status)` (also a theme token).

The values are strings (CSS-var references like
`"var(--color-http-method-get)"`), but `Text.color` today is a closed enum
(`"inherit" | "default" | "light" | "dark" | "error" | "warning" | "success" | "primary"`).
Extending the enum every time a new semantic colour appears scales poorly —
the next epic that needs a graph node colour, a diff hunk colour, or an HTTP
status colour each forces a one-shot enum entry.

Accepting any string and falling back to inline `style.color` keeps the
strict enum path (typo-proof, theme-aware data-attribute selector) and adds
an escape hatch for theme tokens that don't have a Text-level name.

### Why `Textarea` width/flex props

Legacy RestClient code is full of
`<TextAreaField style={{ width: "30%", flex: "1 1 auto", minWidth: 80, ... }}>`.
UIKit `Textarea` currently exposes only `minHeight` / `maxHeight`. Without the
new props, the migration would either pass `style=` (Rule 7 violation) or
wrap every Textarea in a Panel just to set its width — neither is acceptable.

The Panel sizing surface (`width` / `minWidth` / `maxWidth`) is the obvious
template. The `flex` resolver follows the same shape as `Panel.flex`
(`boolean | number | string`).

### Why `Panel.dimmed`

The RestClient KeyValueEditor row and FormDataEditor row both render at
`opacity: 0.5` when disabled, **but the checkbox inside must remain
clickable** so the user can re-enable the row. UIKit `Panel.disabled` sets
both `opacity: 0.6` and `pointer-events: none`, which blocks the
re-enable click.

`dimmed` is the visual half of `disabled` without the interaction half. The
two props are independent and may coexist on the same Panel.

### Pattern references

- `Panel`'s existing `width` / `minWidth` / `maxWidth` / `flex` props
  (`src/renderer/uikit/Panel/Panel.tsx:54-65, 30-32`) — the resolver and
  type signature copy directly.
- `Panel`'s `disabled` styled rule (`Panel.tsx:192-194`) shows the
  `opacity` + `pointer-events: none` shape that `dimmed` deliberately
  splits in half.
- `Text`'s existing `&[data-color="…"]` selector block
  (`src/renderer/uikit/Text/Text.tsx:69-77`) stays intact — only a fallback
  branch is added for non-named values.

### Why no Text `&[data-variant="link"]` regression

`Text.tsx`'s `&[data-variant="link"]` selector applies `color:
color.primary.text` after the `&[data-color="…"]` block in the styled
object. When the new free-form path sets `style.color`, inline `style` has
higher specificity than the styled-rule cascade, so a custom-coloured link
shows the caller's colour. This is the expected escape-hatch behaviour —
callers explicitly opted in.

## Implementation plan

### Step 1 — `Text.color` accepts free-form CSS colour

File: `src/renderer/uikit/Text/Text.tsx`.

**1.1 Widen the type:**

```ts
// Before
export type TextColor =
    | "inherit" | "default" | "light" | "dark"
    | "error" | "warning" | "success" | "primary";

export interface TextStyleProps {
    /** Text color. Default: "default" (color.text.default). */
    color?: TextColor;
    // …
}

// After
export type TextColor =
    | "inherit" | "default" | "light" | "dark"
    | "error" | "warning" | "success" | "primary";

export interface TextStyleProps {
    /**
     * Text colour. A named token (`"error"`, `"primary"`, …) hits the
     * theme-aware `data-color` style rule. A free-form CSS colour string
     * (e.g. a theme token reference like `color.misc.blue` or
     * `universalColors.http.method.get`) is applied as inline `style.color`.
     *
     * Callers must pass theme references, never literal hex/rgb values —
     * the "No hardcoded colors" rule in CLAUDE.md still applies. Default:
     * `"default"`.
     */
    color?: TextColor | (string & {});
    // …
}
```

The `(string & {})` intersection preserves IntelliSense suggestions for the
named tokens — without it, the literal types collapse to plain `string` and
autocomplete loses the hints.

**1.2 Detection helper + render:**

Add at module scope (after the type declarations):

```ts
const NAMED_COLORS: ReadonlySet<string> = new Set<TextColor>([
    "inherit", "default", "light", "dark",
    "error", "warning", "success", "primary",
]);

function isNamedColor(c: string): c is TextColor {
    return NAMED_COLORS.has(c);
}
```

Inside the `Text` function:

```tsx
const isNamed = isNamedColor(colorProp);
const style = isNamed ? undefined : { color: colorProp };

return (
    <Root
        data-type="text"
        data-name={name}
        data-variant={variant}
        data-color={isNamed ? colorProp : undefined}
        data-size={size}
        data-bold={bold || undefined}
        data-italic={italic || undefined}
        data-nowrap={nowrap || undefined}
        data-pre-wrap={preWrap || undefined}
        data-truncate={truncate || undefined}
        data-align={align || undefined}
        style={style}
        {...rest}
    >
        {children}
    </Root>
);
```

`style` is set before the `{...rest}` spread so caller-supplied attributes
still take priority for non-style data-attrs (no caller can pass `style` —
it's excluded by the `Omit` clause).

**1.3 Storybook:**

Rename `src/renderer/uikit/Text/Text.story.ts` → `Text.story.tsx`. Replace
the direct `component: Text` registration with a small `TextDemo` wrapper
that exposes the existing knobs plus a `customColor` string knob:

```tsx
import React from "react";
import { Text } from "./Text";
import color from "../../theme/color";
import { Story } from "../../editors/storybook/storyTypes";

interface DemoProps {
    children?: string;
    variant?: "default" | "uppercased" | "link";
    color?: string;       // named-token enum
    customColor?: string; // free-form override; non-empty wins
    size?: string;
    italic?: boolean;
    bold?: boolean;
    nowrap?: boolean;
    preWrap?: boolean;
    truncate?: boolean;
}

function TextDemo({ customColor, color: colorProp, ...rest }: DemoProps) {
    return <Text color={customColor || colorProp} {...rest} />;
}

export const textStory: Story = {
    id: "text",
    name: "Text",
    section: "Bootstrap",
    component: TextDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "children",    type: "string",  default: "Sample text" },
        { name: "variant",     type: "enum",    options: ["default", "uppercased", "link"], default: "default" },
        { name: "color",       type: "enum",    options: ["default", "light", "dark", "inherit", "error", "warning", "success", "primary"], default: "default", label: "Named color" },
        { name: "customColor", type: "string",  default: "", label: "Custom color (free-form; overrides named)" },
        { name: "size",        type: "enum",    options: ["xs", "sm", "md", "base", "lg", "xl", "xxl"], default: "base" },
        { name: "italic",      type: "boolean", default: false },
        { name: "bold",        type: "boolean", default: false },
        { name: "nowrap",      type: "boolean", default: false },
        { name: "preWrap",     type: "boolean", default: false },
        { name: "truncate",    type: "boolean", default: false },
    ],
};
```

`storyRegistry.ts` import path stays `../../uikit/Text/Text.story` —
TypeScript resolves `.tsx` without an extension change.

### Step 2 — `Textarea` width / minWidth / maxWidth / flex props

File: `src/renderer/uikit/Textarea/Textarea.tsx`.

**2.1 Add the props to `TextareaProps`:**

```ts
/** Fixed width — number → px, string passes through (e.g. "30%"). */
width?: number | string;
/** Min width — number → px, string passes through. */
minWidth?: number | string;
/** Max width — number → px, string passes through. */
maxWidth?: number | string;
/** Flex shorthand on self. `true` → "1 1 auto"; number → "<n> 1 auto"; string passes through. Mirrors `Panel.flex`. */
flex?: boolean | number | string;
```

Insert next to the existing `minHeight` / `maxHeight` lines (~line 39).

**2.2 Destructure in `Textarea`:**

```ts
const {
    name,
    value,
    onChange,
    placeholder,
    disabled,
    readOnly,
    singleLine,
    minHeight,
    maxHeight,
    width,
    minWidth,
    maxWidth,
    flex,
    size = "md",
    variant = "default",
    autoFocus,
    ...rest
} = props;
```

**2.3 Extend the `style` builder (currently lines 200-202):**

```ts
const style: React.CSSProperties = {};
if (minHeight !== undefined) style.minHeight = minHeight;
if (maxHeight !== undefined) style.maxHeight = maxHeight;
if (width      !== undefined) style.width    = width;
if (minWidth   !== undefined) style.minWidth = minWidth;
if (maxWidth   !== undefined) style.maxWidth = maxWidth;
if (flex       !== undefined) {
    style.flex = flex === true ? "1 1 auto"
               : typeof flex === "number" ? `${flex} 1 auto`
               : flex;
}
```

The resolver matches `Panel.flex` so callers learn one mental model. No new
Storybook knobs (existing Textarea story has no demo wrapper; deferred —
the props are exercised end-to-end via US-501 KeyValueEditor + URL bar).

### Step 3 — `Panel.dimmed`

File: `src/renderer/uikit/Panel/Panel.tsx`.

**3.1 Add the prop (after `disabled?: boolean` around line 119):**

```ts
/**
 * Dim the panel (visual only) without disabling pointer events. Use when a
 * row is in a "disabled but still re-enableable" state — the dim is the
 * visual cue, but a child control (typically a checkbox) must remain
 * clickable. Distinct from `disabled` which also adds `pointer-events: none`.
 */
dimmed?: boolean;
```

**3.2 Add the styled rule (next to the existing `&[data-disabled]` block ~lines 192-194):**

```ts
"&[data-dimmed]": {
    opacity: 0.5,
},
```

Use `opacity: 0.5` (not `0.6`) to keep `dimmed` visually distinct from
`disabled` — a user pulling up a row with both checkbox-disabled and an
ambient `disabled` Panel should still see a single dimmed surface.

**3.3 Emit `data-dimmed` on the root** (around line 384, next to
`data-disabled`):

```tsx
data-dimmed={dimmed || undefined}
```

**3.4 Destructure in the component body** — add `dimmed` to the destructured
props.

No Storybook changes — the `Panel` story already covers all sizing /
alignment / color props; one more boolean knob is not worth a story rewrite.

### Step 4 — Verification

- `npx tsc -p tsconfig.json --noEmit` — confirm zero new errors. Baseline
  errors (pre-existing) live in `automation/commands.ts`,
  `editors/video/VideoPlayerEditor.tsx`, `scripting/worker/WorkerRunner.ts`,
  `ui/tabs/PageTab.tsx`.
- `npm run lint` clean.
- Storybook smoke pass:
  - Open the **Text** story. With `color="error"`, the named path still
    renders (data-color attribute). Set `customColor` to
    `var(--color-misc-blue)` — the text turns blue.
  - Set `variant="link"` + `customColor="#9c27b0"` — verify the inline
    `style.color` wins over the link variant's `color.primary.text`.
- No screen retrofits in this task (per
  `feedback_uikit_primitive_with_retrofit.md`). US-501 owns its
  KeyValueEditor / RequestBuilder / ResponseViewer retrofits.

## Concerns

### Q1 — Should `Text.color` keep `data-color="default"` as the default? — **RESOLVED**

Yes. The default `colorProp = "default"` still hits the named path and
applies `data-color="default"` → `color.text.default`. No regression.
Existing callers without `color` set work identically.

### Q2 — Does the link variant still win over a named color? — **RESOLVED**

Yes for named colours (CSS source order in the styled block puts
`&[data-variant="link"]` after `&[data-color="…"]`). No for free-form
colours — inline `style.color` has higher specificity than the styled
selector, so a free-form colour overrides the link colour. This is the
expected escape-hatch behaviour.

### Q3 — Should the free-form value be a separate prop? — **RESOLVED**

No. The user requested a single `color` prop that accepts either form.
The `(string & {})` trick preserves IntelliSense for the named literals.
Detecting via a `Set` lookup adds one O(1) check per render.

### Q4 — How do we enforce "no literal hex" at the type level? — **RESOLVED (documented only)**

We can't — TypeScript has no built-in CSS-colour vs theme-token distinction.
The JSDoc on the prop calls it out explicitly. The CLAUDE.md "No hardcoded
colors" rule already applies project-wide; future `/review` runs catch
violations.

### Q5 — Why a single bundle task rather than three separate tasks? — **RESOLVED**

All three are tiny (~10 lines each), share a "remove the inline-style
escape hatch" theme, and all unblock US-501. A single task minimises
review overhead and produces one cohesive commit. The Storybook test
matrix (Step 4) covers all three in one Storybook session.

### Q6 — Do we need a `Textarea` story update? — **RESOLVED (no)**

The existing Textarea story has no demo wrapper and no width-related
knobs. Adding four sizing knobs to it duplicates Panel's story without new
information. The props are exercised end-to-end via US-501 KeyValueEditor
(URL textarea, key/value textareas) where the user can validate them in
the real layout.

## Acceptance criteria

- [ ] `Text.color` accepts `TextColor | (string & {})`; IntelliSense still
  suggests the named tokens.
- [ ] `<Text color="error">` and `<Text color="default">` render identically
  to today (theme-aware data-color rule).
- [ ] `<Text color={color.misc.blue}>` renders with inline `style.color`
  set to the resolved CSS-var reference, regardless of variant.
- [ ] `Textarea` exposes `width` / `minWidth` / `maxWidth` / `flex`; the
  `flex` resolver matches `Panel.flex`.
- [ ] `Panel.dimmed={true}` adds `opacity: 0.5` and `data-dimmed` on the
  root; pointer events remain active (a Checkbox inside is clickable).
- [ ] `Panel.dimmed` and `Panel.disabled` may coexist; both
  `data-disabled` and `data-dimmed` are present and the cascade renders
  the lower opacity (whichever wins by source order).
- [ ] `npm run lint` clean; `npx tsc -p tsconfig.json --noEmit` reports no
  new errors versus baseline.
- [ ] Storybook **Text** story renders with a `Custom color` string knob;
  setting it to a `var(--color-*)` value paints the text.
- [ ] US-501's Concern B / C / F all close out via this task.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred-review model.

## Files Changed

| File | Change | Lines (approx.) |
|---|---|---:|
| `src/renderer/uikit/Text/Text.tsx` | Widen `TextColor` to `TextColor \| (string & {})`; add `NAMED_COLORS` set + detection; emit `style.color` for non-named values | +~12 |
| `src/renderer/uikit/Text/Text.story.ts` → `Text.story.tsx` | Rename; add `TextDemo` wrapper and `customColor` string knob | rewrite |
| `src/renderer/uikit/Textarea/Textarea.tsx` | Add `width` / `minWidth` / `maxWidth` / `flex` props; extend inline style builder | +~12 |
| `src/renderer/uikit/Panel/Panel.tsx` | Add `dimmed?: boolean` prop + `&[data-dimmed]` styled rule + `data-dimmed` attribute | +~8 |
| `doc/active-work.md` | US-534 entry added; US-501 entry updated to reference US-534 blocker | +1 / ~1 |
| `doc/tasks/US-501-rest-client-migration/README.md` | Remove Step 0; update Concern B/C/F to "RESOLVED via US-534"; update Files Changed table; add US-534 to blockers and Links | ~30 |

## Files NOT Changed

- `src/renderer/uikit/Input/Input.tsx` — `Input` already has the `flex`
  resolver this task copies; no widening needed.
- `src/renderer/uikit/Panel/Panel.tsx` size props (`width` / `minWidth` /
  `maxWidth`) — already present; only `dimmed` is added.
- `src/renderer/theme/color.ts`, `theme/universal-colors.ts` — no new
  tokens; this task is API-only.
- `src/renderer/uikit/Panel/Panel.story.tsx`,
  `src/renderer/uikit/Textarea/Textarea.story.*` — see Q6.
- `src/renderer/editors/rest-client/**` — RestClient retrofit is
  US-501's responsibility (per
  `feedback_uikit_primitive_with_retrofit.md`).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-501: RestClient editor — UIKit migration](../US-501-rest-client-migration/README.md)
- Related primitives:
  - `src/renderer/uikit/Panel/Panel.tsx` — `width` / `minWidth` / `maxWidth` / `flex` resolver (copied for `Textarea`)
  - `src/renderer/uikit/Text/Text.tsx` — `&[data-color="…"]` selector block (preserved)
- Pattern memory:
  - `feedback_uikit_primitive_with_retrofit.md` — primitive ships alone; per-screen retrofits live in US-501
  - `feedback_uikit_spread_rest.md` — preserved (no event-handler enumeration)
