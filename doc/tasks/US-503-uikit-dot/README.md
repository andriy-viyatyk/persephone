# US-503: UIKit `Dot` primitive — colored circle for status / swatch / palette

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
UIKit primitive infrastructure. Unblocks the swatch/dot work in
[US-498](../US-498-settings-page-migration/README.md), and benefits later
migrations (US-499 TodoEditor, US-502 MCP Inspector) plus existing call sites
in BrowserEditor / MainPage / Tag.story.

## Goal

Add a single UIKit primitive `Dot` that renders a colored filled circle. It
unifies three visual patterns currently re-implemented per-file:

- **Status indicators** — small (6-8px) circle showing connected/disconnected/error/etc.
- **Profile / tag color dots** — small bordered circle showing a user-chosen color.
- **Color palette swatches** — larger (14-18px) clickable circle with a selection ring.

This task introduces the primitive only. Existing inline-styled circles stay
in place and are migrated by their owning per-screen tasks — see C6 for the
ownership table. New code from this task forward should use `<Dot>` instead
of an inline `borderRadius: "50%"` span.

## Background

### Cross-codebase audit — confirmed call sites

`grep` found ~12 real Dot consumers across 5+ files (slider thumbs in
GraphTuningSliders/AudioControls excluded — those are not Dot atoms). All use
`borderRadius: "50%"` with `width === height` plus a fill color.

| File | Class / inline | Diameter | Color | Variants |
|---|---|---|---|---|
| `editors/settings/SettingsPage.tsx` | `.profile-color-dot` | 12 | `profile.color` (hex) | bordered, optionally clickable (in `WithMenu` trigger) |
| `editors/settings/SettingsPage.tsx` | `.color-swatch` | 18 | `c.hex` | selection ring (transparent → `color.text.default` when `selected`) |
| `editors/settings/SettingsPage.tsx` | `.mcp-status-dot` | 8 | semantic — `running ? success : neutral` | none |
| `editors/settings/SettingsPage.tsx` | menu-item icon (color picker) | 10 | `c.hex` | inside `MenuItem.icon` ReactNode |
| `editors/mcp-inspector/McpInspectorView.tsx` | `.status-dot` | 6 | semantic — connected / connecting / disconnected / error | none |
| `editors/browser/BrowserEditorView.tsx` | debugger-status dot | 6 | semantic — connected / error / disconnected | none |
| `ui/app/MainPage.tsx` | `.mcp-dot` | 7 | fixed `color.misc.green` | none |
| `editors/todo/components/TodoListPanel.tsx` | `.tag-dot` | 8 | tag color (hex) | none |
| `editors/todo/components/TodoListPanel.tsx` | `.color-swatch` | 14 | `c.hex` | selection ring |
| `editors/todo/components/TodoListPanel.tsx` | menu-item icon (color picker) | 10 | `c.hex` | inside `MenuItem.icon` ReactNode |
| `editors/todo/components/TodoItemView.tsx` | `.tag-dot` | 8 | tag color (hex) | none |
| `editors/todo/components/TodoItemView.tsx` | menu-item icon (color picker) | 8 | `tag.color` (hex) | inside `MenuItem.icon` ReactNode |
| `uikit/Tag/Tag.story.tsx` | story icon demo | 8 | `color.misc.blue` | none |

**Diameter range:** 6, 7, 8, 10, 12, 14, 18 px. Seven distinct values; no
named-size scale covers them all → API must accept `number` as well as named
sizes.

**Color sources:** mix of (a) **semantic tokens** for status indicators
(success/warning/error/etc.) and (b) **raw hex strings** for user-chosen
profile / tag palette colors. API must accept both.

**Selection state:** only color-palette consumers need it (Settings
`.color-swatch`, Todo `.color-swatch`). The pattern is always the same: 2px
transparent border at rest → 2px `color.text.default` border when selected.
Reserves layout space at rest so the selection ring doesn't push siblings.

**Border:** the Settings `.profile-color-dot` adds `1px solid
color.border.default` (visual chrome around an arbitrary fill color so it
stays visible on dark backgrounds). Independent from selection state.

### Existing token support

`uikit/tokens.ts` already exports `radius.full = "50%"` — `Dot` uses it.

### Why one primitive, not two (`StatusDot` + `Swatch`)

Both share identical DOM (single `<span>` with width === height === diameter,
filled background, optional border). The only meaningful difference is in
props (color source, click handler, selection state). Splitting into two
components would double the API surface for no structural benefit, and a
reader would have to know "is this the click-pickable kind or the
status-indicator kind?" to find it. One `Dot` with optional `onClick` /
`selected` props is cleaner.

## Component design

File: `src/renderer/uikit/Dot/Dot.tsx`

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { radius } from "../tokens";

// --- Types ---

export type DotColor =
    | "success"
    | "warning"
    | "error"
    | "info"
    | "neutral"
    | "active";

export interface DotProps
    extends Omit<
        React.HTMLAttributes<HTMLSpanElement>,
        "style" | "className" | "color" | "children"
    > {
    /**
     * Diameter. Named sizes map to common dot sizes used across the app:
     *   xs = 6, sm = 8, md = 12, lg = 18.
     * Pass a number to use an exact pixel diameter (e.g. 7, 10, 14). Default: "sm".
     */
    size?: "xs" | "sm" | "md" | "lg" | number;
    /**
     * Fill color. Accepts either:
     *   • A semantic token name — resolved against the active theme via `color.misc`/`color.success`/etc.
     *   • A raw color string (hex, rgb, css var) — used for user-chosen palette colors.
     */
    color: DotColor | string;
    /**
     * Render a thin border using `color.border.default`. Use to keep an
     * arbitrary fill color visible on dark / light backgrounds. Independent
     * from `selected`.
     */
    bordered?: boolean;
    /**
     * Selection ring. When provided, the dot reserves a 2px ring at rest
     * (transparent) and shows it (`color.text.default`) when `true`. Used by
     * color-palette pickers. When set, `bordered` is ignored — the ring takes
     * its place.
     */
    selected?: boolean;
}
```

### Size mapping

```ts
const SIZE_MAP = {
    xs: 6,
    sm: 8,
    md: 12,
    lg: 18,
} as const;

function diameter(size: DotProps["size"]): number {
    if (typeof size === "number") return size;
    return SIZE_MAP[size ?? "sm"];
}
```

### Color resolution

```ts
function resolveFill(c: DotColor | string): string {
    switch (c) {
        case "success": return color.success.text;
        case "warning": return color.warning.text;
        case "error":   return color.error.text;
        case "info":    return color.misc.blue;
        case "neutral": return color.text.light;
        case "active":  return color.border.active;
        default:        return c; // raw hex / rgb / css var
    }
}
```

The semantic token list is intentionally small — these six names cover every
existing call site:
- `success` (connected, running) — McpInspector, MainPage, BrowserEditor
- `warning` (connecting) — McpInspector
- `error` (error) — McpInspector, BrowserEditor
- `info` (general informational) — Tag.story (was `color.misc.blue` directly)
- `neutral` (disconnected, idle) — McpInspector, BrowserEditor, Settings idle MCP state
- `active` (selected/current) — currently no consumers, but recurs in UIKit (`color.border.active`); included for parity with Panel `borderColor="active"`

If a future consumer needs a different semantic (e.g. `disabled`), it's added
to `DotColor` and `resolveFill` in one place.

### Render

```tsx
const Root = styled.span(
    {
        display: "inline-block",
        flexShrink: 0,
        borderRadius: radius.full,
        boxSizing: "border-box",

        "&[data-clickable]": {
            cursor: "pointer",
            transition: "border-color 0.15s",
        },
        "&[data-clickable]:hover": {
            outlineColor: color.text.light, // subtle hover affordance for raw-color dots
        },
    },
    { label: "Dot" },
);

export function Dot(props: DotProps) {
    const { size = "sm", color: colorProp, bordered, selected, onClick, ...rest } = props;
    const d = diameter(size);
    const fill = resolveFill(colorProp);
    const clickable = onClick !== undefined;

    // Build inline style for size + color + border
    const style: React.CSSProperties = {
        width: d,
        height: d,
        backgroundColor: fill,
    };

    if (selected !== undefined) {
        // Selection-ring mode: reserve 2px ring at rest, show on selected
        style.border = `2px solid ${selected ? color.text.default : "transparent"}`;
    } else if (bordered) {
        style.border = `1px solid ${color.border.default}`;
    }

    return (
        <Root
            {...rest}
            data-type="dot"
            data-clickable={clickable || undefined}
            data-selected={selected || undefined}
            data-bordered={bordered || undefined}
            onClick={onClick}
            style={style}
        />
    );
}
```

Notes on the implementation:
- Spreads `{...rest}` first — `onClick`, `title`, `aria-*`, `data-*` flow through automatically; owned props (`data-type`, `style`) come after so callers can't override.
- `Root` is a `<span>` (inline-block), matches existing `<span>`-based usages in the codebase. Consumers in flex containers behave identically.
- `radius.full = "50%"` from existing tokens.
- No `Tooltip` integration — `title` (HTML attribute) bypasses through the spread. UIKit `Tooltip` can wrap the Dot externally if rich tooltip content is needed.
- Size is applied via inline `style` (not `data-size` + Emotion lookup) because the size scale extends to arbitrary numbers — Emotion attribute selectors can't enumerate every number. Inline-style is the established pattern (Panel does the same for `width`/`height`).

## Concerns

### C1 — Should `Dot` accept any prop that matches `Omit<HTMLAttributes<HTMLSpanElement>, …>`?

**Concern.** Following the spread-rest convention from the Textarea refactor in
US-498, `Dot` should extend `HTMLAttributes<HTMLSpanElement>` with `Omit` for
owned props. The owned/conflicting props are: `style` (component-controlled),
`className` (Rule 7), `color` (HTML attribute conflicts with the semantic
prop name), `children` (no children — Dot is a self-closing visual atom).

**Resolution.** Use exactly that Omit list. `onClick`, `title`, `onMouseEnter`,
`onMouseLeave`, `aria-*`, `data-*`, `id` all bypass automatically. Done above.

### C2 — Hover affordance for clickable dots

**Concern.** Today the Settings `.profile-color-dot.clickable` and
`.color-swatch` show a small `:hover` outline (visible only on hover). A pure
inline `style` can't express `:hover`; we need this from a styled component.

**Resolution.** The `Root` styled component handles `&[data-clickable]:hover`
internally — clickable dots get a subtle outline-color transition on hover.
Selection (when `selected` is set) takes precedence and does not need a
separate hover state since the selection ring is already a clear affordance.
The hover outline is a fixed visual nicety; consumers don't configure it.

### C3 — Numeric sizes vs named sizes

**Concern.** Real call-sites use 6, 7, 8, 10, 12, 14, 18 — seven values across
five named tokens (xs/sm/md/lg). 7 and 14 don't fit any named slot.

**Resolution.** API accepts `number` directly. Named sizes are conveniences
for the most common cases (6 / 8 / 12 / 18). Anything else uses
`size={7}` / `size={14}` etc. — same convention as Input `width` (named not
required, numbers welcome). Document this in the JSDoc.

### C4 — Tooltip support

**Concern.** Several existing call sites pass a `title` for the dot
(Settings `.color-swatch` shows the color name on hover; profile-color-dot
shows "Change color"). Should `Dot` integrate UIKit `Tooltip` like Button does?

**Resolution.** No — for two reasons:
1. The HTML `title` attribute bypasses through the spread already, giving the
   default browser tooltip — fine for one-word color names like "Blue".
2. If a consumer needs rich tooltip content, they wrap the `Dot` in
   `<Tooltip content={...}><Dot ... /></Tooltip>`. Adding tooltip integration
   to Dot would couple a tiny visual atom to the overlay layer; not worth it.

### C5 — Should `Dot` have a `disabled` state?

**Concern.** No current consumer uses a disabled variant. YAGNI says skip.

**Resolution.** Skip. If later needed, add `disabled?: boolean` and a
`&[data-disabled]` rule to the `Root` styled component (opacity 0.5,
pointer-events: none). One-line addition; no need to design ahead.

### C6 — Migration scope — primitive only; per-screen retrofits happen later

**Concern.** Two options:
- **(a)** US-503 = primitive only. Existing inline-styled circles stay in place. Each later per-screen migration (US-498 Settings, US-499 Todo, US-502 MCP Inspector) swaps its own dots when it picks up.
- **(b)** US-503 = primitive + retrofit all 12+ call sites in one task.

**Resolution.** **Option (a)** — primitive only. Reasoning:
- Testing isolation: a single 12-call-site retrofit changes screens scattered across the app (Settings / McpInspector / BrowserEditor / MainPage / Todo×2). Verifying every screen fully in one PR is impractical, and a regression in one screen would be hard to localize.
- Each per-screen migration already includes a manual smoke pass on that screen. Including the dot retrofit in the per-screen task means dot regressions are caught in the same test pass that verifies the rest of the screen — natural coupling of change and test.
- The cost of carrying inline-styled circles for a few more weeks is near zero — they keep working.

**Consequence:** Step 2 (retrofit) is removed from this task. The dot retrofits
land later, distributed across these owners:

| Call site | Will be retrofitted by |
|---|---|
| `editors/settings/SettingsPage.tsx` (4 sites) | US-498 (Settings migration) |
| `editors/mcp-inspector/McpInspectorView.tsx` (1 site, 4 variants) | US-502 (MCP Inspector migration) |
| `editors/todo/components/TodoListPanel.tsx` (3 sites) | US-499 (TodoEditor migration) |
| `editors/todo/components/TodoItemView.tsx` (2 sites) | US-499 (TodoEditor migration) |
| `editors/browser/BrowserEditorView.tsx` (1 site) | Future BrowserEditor migration task (not yet planned) |
| `ui/app/MainPage.tsx` (1 site) | Chrome — eligible for chrome exception (`src/renderer/ui/`); retrofit when convenient |
| `uikit/Tag/Tag.story.tsx` (1 site) | Cosmetic story-only update — can be done in this task or the next time Tag is touched |

US-498's plan already references `<Dot>` for the Settings retrofit (in its
C1) — so once US-503 lands, US-498 can resume with `Dot` in scope.

## Implementation plan

### Step 1 — Create the `Dot` primitive

Files to create:
- `src/renderer/uikit/Dot/Dot.tsx` — implementation per the design above.
- `src/renderer/uikit/Dot/index.ts` — `export { Dot } from "./Dot"; export type { DotProps, DotColor } from "./Dot";`

Files to edit:
- `src/renderer/uikit/index.ts` — add `Dot` to public exports (in the
  "Bootstrap components" section, alphabetically near `Divider`).

### Step 2 — Create the Storybook story for `Dot`

The Storybook editor in this repo does **not** auto-discover stories. Each
story is a named export from `<Component>.story.tsx` and is explicitly
imported and added to the `ALL_STORIES` array in
`src/renderer/editors/storybook/storyRegistry.ts`. So this step has two parts.

**Part A — `src/renderer/uikit/Dot/Dot.story.tsx`** (new file)

Follow the established story shape (see `Divider.story.tsx`, `Spinner.story.tsx`
for reference patterns):

```tsx
import React from "react";
import { Dot, DotColor } from "./Dot";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const DotPreview = ({
    size,
    color,
    bordered,
    selected,
    clickable,
}: {
    size?: "xs" | "sm" | "md" | "lg" | number;
    color?: DotColor | string;
    bordered?: boolean;
    selected?: boolean;
    clickable?: boolean;
}) => {
    // Demo grid: a single configurable dot at the top, plus a row of canonical
    // examples below so the visual reference is always visible.
    return (
        <Panel direction="column" gap="xl" padding="xl">
            <Panel direction="row" align="center" gap="md">
                <span>Configurable:</span>
                <Dot
                    size={size}
                    color={color ?? "success"}
                    bordered={bordered}
                    selected={selected}
                    onClick={clickable ? () => console.log("dot clicked") : undefined}
                    title="Configurable dot"
                />
            </Panel>

            <Panel direction="column" gap="md">
                <span>Sizes (named):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="xs" color="success" />
                    <Dot size="sm" color="success" />
                    <Dot size="md" color="success" />
                    <Dot size="lg" color="success" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Sizes (numeric — for non-token diameters):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size={7}  color="success" />
                    <Dot size={10} color="success" />
                    <Dot size={14} color="success" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Semantic colors:</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot color="success" />
                    <Dot color="warning" />
                    <Dot color="error" />
                    <Dot color="info" />
                    <Dot color="neutral" />
                    <Dot color="active" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Raw hex (palette colors):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot color="#e91e63" bordered />
                    <Dot color="#9c27b0" bordered />
                    <Dot color="#3f51b5" bordered />
                    <Dot color="#ff9800" bordered />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Selection ring (palette swatches — click the selected one to verify ring):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="lg" color="#e91e63" selected={false} onClick={() => {}} />
                    <Dot size="lg" color="#9c27b0" selected={true}  onClick={() => {}} />
                    <Dot size="lg" color="#3f51b5" selected={false} onClick={() => {}} />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Bordered vs. non-bordered (same color, dark bg vs light bg):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot color="#444444" />
                    <Dot color="#444444" bordered />
                </Panel>
            </Panel>
        </Panel>
    );
};

export const dotStory: Story = {
    id: "dot",
    name: "Dot",
    section: "Bootstrap",
    component: DotPreview as any,
    props: [
        { name: "size", type: "enum", options: ["xs", "sm", "md", "lg", 7, 10, 14], default: "sm" },
        { name: "color", type: "enum", options: ["success", "warning", "error", "info", "neutral", "active", "#e91e63", "#9c27b0", "#3f51b5"], default: "success" },
        { name: "bordered", type: "boolean", default: false },
        { name: "selected", type: "boolean", default: false },
        { name: "clickable", type: "boolean", default: false },
    ],
};
```

(Verify the exact `Story` / `props` shape against `storyTypes.ts` and an
existing story like `Divider.story.tsx` at implementation time — the snippet
above matches the pattern used elsewhere in `uikit/`.)

**Part B — Register in `storyRegistry.ts`**

Edit `src/renderer/editors/storybook/storyRegistry.ts`:

1. Add an import alongside the other Bootstrap entries (alphabetical near
   `dividerStory`):
   ```ts
   import { dotStory } from "../../uikit/Dot/Dot.story";
   ```
2. Add `dotStory` to the `ALL_STORIES` array in the same Bootstrap row that
   currently lists `dividerStory`.

Without this registration the story will not appear in the Storybook UI even
though the file exists.

### Step 3 — Verification

- `npm run lint` — clean.
- `npx tsc --noEmit` — no new errors.
- `npm start` — open the Storybook editor and find `Dot` under the
  "Bootstrap" section.
- Verify all variants render correctly:
    - All named sizes (`xs`, `sm`, `md`, `lg`) and the numeric sizes (`7`, `10`, `14`).
    - All semantic colors (`success`, `warning`, `error`, `info`, `neutral`, `active`).
    - A few raw hex colors.
    - `bordered` on / off.
    - `selected={true}` shows a 2px `color.text.default` ring; `selected={false}` reserves the same 2px space with a transparent border (no layout shift between states).
    - Clickable variant — `onClick` fires and the subtle hover affordance is visible.
    - Row of dots with `gap` confirms `flexShrink: 0` keeps each dot circular under flex pressure.
    - PropertyEditor lets you toggle each prop and the preview updates live.

No call-site changes in this task — existing inline-styled circles stay in
place and are migrated by their owning per-screen tasks (see the table in C6).

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Dot/Dot.tsx` | New file — `Dot` component |
| `src/renderer/uikit/Dot/Dot.story.tsx` | New file — Storybook story (`dotStory` named export) |
| `src/renderer/uikit/Dot/index.ts` | New file — public exports |
| `src/renderer/uikit/index.ts` | Add `Dot` to public exports |
| `src/renderer/editors/storybook/storyRegistry.ts` | Import `dotStory` and add to `ALL_STORIES` (Bootstrap section) |

Files NOT changed in this task (each retrofitted later by its owning per-screen migration — see C6 ownership table):
- `src/renderer/editors/settings/SettingsPage.tsx` — retrofit by US-498
- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` — retrofit by US-502
- `src/renderer/editors/todo/components/TodoListPanel.tsx` — retrofit by US-499
- `src/renderer/editors/todo/components/TodoItemView.tsx` — retrofit by US-499
- `src/renderer/editors/browser/BrowserEditorView.tsx` — retrofit by future BrowserEditor migration task
- `src/renderer/ui/app/MainPage.tsx` — chrome (`src/renderer/ui/`); retrofit when convenient (chrome exception applies)
- `src/renderer/uikit/Tag/Tag.story.tsx` — cosmetic story; can be retrofitted next time Tag is touched

Files NOT changed at all:
- `src/renderer/editors/graph/GraphTuningSliders.tsx` — `borderRadius: "50%"` is a `<input type="range">` slider thumb, not a dot atom.
- `src/renderer/editors/video/AudioControls.tsx` — same (slider thumb).
- All theme files — semantic colors are sourced from existing `color.success`, `color.warning`, etc.

## Acceptance criteria

- [ ] `Dot` primitive exists at `src/renderer/uikit/Dot/Dot.tsx` and is exported from `uikit/index.ts`.
- [ ] Storybook entry covers all variants: every named size + a numeric size, every semantic color + a raw hex, `bordered` on/off, `selected` true/false, clickable variant with hover affordance.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] No regressions on any existing inline-styled circle (none of them are touched in this task — verify by diff that the only changes are inside `src/renderer/uikit/Dot/` and one line in `src/renderer/uikit/index.ts`).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-498](../US-498-settings-page-migration/README.md) Settings migration (paused; resumes after this lands)
- Benefits: US-499 TodoEditor, US-502 MCP Inspector, plus existing call sites in BrowserEditor / MainPage
