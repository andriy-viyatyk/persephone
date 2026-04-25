# US-451: UIKit Layout Refactor — Unified Panel + Storybook Lighthouse

## Goal

Replace `Flex` / `HStack` / `VStack` / `Card` with a **single `Panel`** component that handles
all flex-based layouts via props. Refactor the Storybook editor to use only UIKit primitives —
no `styled.*` calls and no `style=` / `className=` props in app code — as the **lighthouse
implementation** of the new "no Emotion outside UIKit" rule. Refactor `Toolbar` to compose
`Panel` internally so layout concerns live in one place.

## Background

### EPIC-025 context

This is part of [EPIC-025 — Unified Component Library](../../epics/EPIC-025.md), Phase 3
polish. It revises decisions made under [US-427 (Layout primitives)](../US-427-layout-primitives/README.md)
based on user direction in chat: collapse the layout primitive surface from five components
(`Flex`, `HStack`, `VStack`, `Panel`, `Card`) down to **one** (`Panel`), and make the
Storybook editor the first editor to follow the new "props-only, no app-side Emotion" pattern.

The motivation is twofold:

1. **JSON descriptors for scripts (EPIC-025 Decision #4 / Phase 6).** Scripts will eventually
   build UIs from descriptors like `{ component: "Panel", direction: "row", gap: "sm" }`. With
   five overlapping primitives, the descriptor must pick a component *name* before it picks
   props — worse for tooling and worse for the human writing the descriptor. With one Panel,
   every layout is the same shape.
2. **Consistency.** Persephone is a single application — the UIKit doesn't need three ways to
   express a flex container. Every editor should look and behave identically because every
   editor uses the same primitive.

### Current state

UIKit currently ships five layout primitives and a Toolbar that re-implements layout from
scratch:

| File | Role | Notes |
|------|------|-------|
| [Flex/Flex.tsx](../../../src/renderer/uikit/Flex/Flex.tsx) | Configurable flex container | direction/gap/align/justify/wrap/flex/padding props |
| Flex/Flex.tsx (HStack export) | `direction="row"` shortcut | Wraps Flex |
| Flex/Flex.tsx (VStack export) | `direction="column"` shortcut | Wraps Flex |
| [Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Bordered, padded vertical container | Default `padding: spacing.md`, border, rounded |
| [Card/Card.tsx](../../../src/renderer/uikit/Card/Card.tsx) | Elevated panel with shadow | Default `padding: spacing.xl`, shadow, rounded |
| [Toolbar/Toolbar.tsx](../../../src/renderer/uikit/Toolbar/Toolbar.tsx) | Roving-tabindex flex row | Re-implements flex layout via `styled.div` |

The Storybook editor mixes UIKit components with several app-side `styled.div` definitions
that re-implement layout (`Root`, `Body`, `ToolbarTitle`, `EmptyMessage`, `SectionLabel`),
plus several `style={...}` props on UIKit components. This is exactly the kind of duplication
the unified Panel is meant to eliminate.

### Why redesign

User decisions from chat (2026-04-25):

1. **Fully retire HStack/VStack** — collapse Flex/HStack/VStack into a single Panel. Same
   reasoning applies to Card: it's just a Panel preset (rounded + shadow + padding).
2. **Default `direction = "row"`** — match CSS `flex-direction` default. Inheriting CSS
   defaults is least surprising.
3. **No `style` / `className` escape hatch yet** — strict from the start. Force AI agents to
   use props (and extend Panel's prop surface when something is missing). Escape hatches can
   be added later when scripts need them.

## Implementation Plan

### Step 1 — Add Rule 7 to `uikit/CLAUDE.md`

Append a new rule section at [src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md)
**after** the existing "Rule 6 — UI Descriptor pattern (`ComponentSet`)" section and **before**
the "Naming conventions" section.

Insert the following text:

```markdown
---

## Rule 7 — No Emotion outside UIKit (mandatory in app code)

Application code (everything outside `src/renderer/uikit/`) **must not** use Emotion or any
inline style escape hatch when composing UIKit components.

**Forbidden in app code:**
- `import styled from "@emotion/styled"` — no `styled.div`, `styled(Component)`, etc.
- `import { css } from "@emotion/css"` — no class generation
- Passing `style={…}` to a UIKit component
- Passing `className=…` to a UIKit component

**The rule on UIKit component types:** UIKit components forbid `style` and `className` at
the type level (`extends Omit<React.HTMLAttributes<…>, "style" | "className">`). Trying to
pass them produces a TypeScript error.

**Inside UIKit (`src/renderer/uikit/`)** Emotion is still used for component implementations.
Internal helpers and primitive HTML elements (`<div style={{…}}>`) are also fine — the rule
applies to *consumers* of UIKit, not to UIKit itself.

**When a layout need can't be expressed by existing props:** extend the UIKit component's
prop surface, do not work around the rule. The right answer is "Panel needs a new prop", not
"this one place needs `style=`".

**Why:**
- **Consistency.** Every screen in Persephone uses the same Panel/Button/Toolbar with the
  same defaults. No one-off styling drift.
- **JSON descriptors.** Scripts will eventually build UIs from descriptor objects
  (`{ component: "Panel", direction: "row", gap: "sm" }`). A descriptor can carry props but
  not Emotion — so anything achievable only through Emotion is unreachable from scripts.
- **AI agent legibility.** With layout expressed in props, an agent can read intent from JSX
  alone without consulting separate `styled.*` blocks.

**When this rule may be relaxed:** when scripts need to ship custom styles into UIs, a curated
escape hatch (e.g. `style?: Pick<CSSProperties, "color" | …>`) may be added — see EPIC-025
Phase 6 (Script UI API). Until then, no escape hatch.
```

### Step 2 — Implement the unified `Panel` component

Replace the entire contents of [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx)
with the implementation below.

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing, gap as gapTokens, radius } from "../tokens";

// --- Types ---

type Size = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";
type Direction = "row" | "column" | "row-reverse" | "column-reverse";
type Overflow = "visible" | "hidden" | "auto" | "scroll";

export interface PanelProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Flex direction. Default: "row" (CSS default). */
    direction?: Direction;
    /** Allow children to wrap. Default: false. */
    wrap?: boolean;

    /** Flex shorthand on self. `true` → "1 1 auto"; number → "<n> 1 auto"; string passes through. */
    flex?: boolean | number | string;
    /** Set `flex-shrink: 0` when `false`. Use for sidebars that must keep their fixed width. */
    shrink?: boolean;

    /** Uniform padding. Side-specific props win over `paddingX`/`paddingY` win over `padding`. */
    padding?: Size;
    paddingX?: Size;
    paddingY?: Size;
    paddingTop?: Size;
    paddingBottom?: Size;
    paddingLeft?: Size;
    paddingRight?: Size;

    /** Gap between children. */
    gap?: Size;

    /** align-items. */
    align?: Align;
    /** justify-content. */
    justify?: Justify;

    /** Fixed width/height in px (number) or any CSS length (string, e.g. "50%"). */
    width?: number | string;
    height?: number | string;

    overflow?: Overflow;
    overflowX?: Overflow;
    overflowY?: Overflow;

    /** All four borders. */
    border?: boolean;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    /** Border color. Default: "subtle" (color.border.light). "default" uses color.border.default. */
    borderColor?: "subtle" | "default";

    /** Border radius from radius scale. */
    rounded?: Size;
    /** Drop shadow (Card-style elevation). */
    shadow?: boolean;
    /** Background fill. Maps to color.background.{default,light,dark}. */
    background?: "default" | "light" | "dark";

    /** Dim + disable pointer events on the whole panel. */
    disabled?: boolean;

    children?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        boxSizing: "border-box",
        // flex-direction: row is the CSS default — no rule needed.

        '&[data-direction="column"]':         { flexDirection: "column" },
        '&[data-direction="row-reverse"]':    { flexDirection: "row-reverse" },
        '&[data-direction="column-reverse"]': { flexDirection: "column-reverse" },

        '&[data-bg="default"]': { backgroundColor: color.background.default },
        '&[data-bg="light"]':   { backgroundColor: color.background.light },
        '&[data-bg="dark"]':    { backgroundColor: color.background.dark },

        // --- Borders (subtle = color.border.light, default = color.border.default) ---
        "&[data-border]":        { border:       `1px solid ${color.border.light}` },
        "&[data-border-top]":    { borderTop:    `1px solid ${color.border.light}` },
        "&[data-border-bottom]": { borderBottom: `1px solid ${color.border.light}` },
        "&[data-border-left]":   { borderLeft:   `1px solid ${color.border.light}` },
        "&[data-border-right]":  { borderRight:  `1px solid ${color.border.light}` },

        '&[data-border-color="default"]':                          { borderColor: color.border.default },
        '&[data-border-color="default"][data-border-top]':         { borderTopColor: color.border.default },
        '&[data-border-color="default"][data-border-bottom]':      { borderBottomColor: color.border.default },
        '&[data-border-color="default"][data-border-left]':        { borderLeftColor: color.border.default },
        '&[data-border-color="default"][data-border-right]':       { borderRightColor: color.border.default },

        "&[data-shadow]": { boxShadow: `0 2px 8px ${color.shadow.default}` },

        "&[data-disabled]": {
            opacity: 0.6,
            pointerEvents: "none",
        },
    },
    { label: "Panel" },
);

// --- Token resolvers ---

const ALIGN_MAP: Record<Align, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    stretch: "stretch",
    baseline: "baseline",
};

const JUSTIFY_MAP: Record<Justify, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    between: "space-between",
    around: "space-around",
    evenly: "space-evenly",
};

function spaceVal(v?: Size): number | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return spacing[v];
}

function gapVal(v?: Size): number | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return gapTokens[v];
}

function radiusVal(v?: Size): number | string | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return radius[v as keyof typeof radius];
}

function flexVal(v: PanelProps["flex"]): string | undefined {
    if (v === undefined || v === false) return undefined;
    if (v === true) return "1 1 auto";
    if (typeof v === "number") return `${v} 1 auto`;
    return v;
}

// --- Component ---

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(function Panel(
    props,
    ref,
) {
    const {
        direction = "row",
        wrap,
        flex,
        shrink,
        padding,
        paddingX,
        paddingY,
        paddingTop,
        paddingBottom,
        paddingLeft,
        paddingRight,
        gap: gapProp,
        align,
        justify,
        width,
        height,
        overflow,
        overflowX,
        overflowY,
        border,
        borderTop,
        borderBottom,
        borderLeft,
        borderRight,
        borderColor,
        rounded,
        shadow,
        background,
        disabled,
        children,
        ...rest
    } = props;

    // Padding specificity: side > axis > all
    const padTop    = paddingTop    ?? paddingY ?? padding;
    const padBottom = paddingBottom ?? paddingY ?? padding;
    const padLeft   = paddingLeft   ?? paddingX ?? padding;
    const padRight  = paddingRight  ?? paddingX ?? padding;

    const inlineStyle: React.CSSProperties = {
        flex: flexVal(flex),
        flexShrink: shrink === false ? 0 : undefined,
        flexWrap: wrap ? "wrap" : undefined,

        paddingTop: spaceVal(padTop),
        paddingBottom: spaceVal(padBottom),
        paddingLeft: spaceVal(padLeft),
        paddingRight: spaceVal(padRight),

        gap: gapVal(gapProp),

        alignItems: align ? ALIGN_MAP[align] : undefined,
        justifyContent: justify ? JUSTIFY_MAP[justify] : undefined,

        width,
        height,
        overflow,
        overflowX,
        overflowY,

        borderRadius: radiusVal(rounded),
    };

    return (
        <Root
            ref={ref}
            data-type="panel"
            data-direction={direction}
            data-bg={background || undefined}
            data-border={border || undefined}
            data-border-top={borderTop || undefined}
            data-border-bottom={borderBottom || undefined}
            data-border-left={borderLeft || undefined}
            data-border-right={borderRight || undefined}
            data-border-color={borderColor || undefined}
            data-shadow={shadow || undefined}
            data-disabled={disabled || undefined}
            {...rest}
            style={inlineStyle}
        >
            {children}
        </Root>
    );
});
```

**Notes for the implementer:**

- Variant-style behaviors (background, borders, shadow, disabled, direction) use Emotion
  attribute selectors per Rule 1.
- Numeric values (paddings, gap, width, height, border-radius) are emitted via inline `style`
  for ergonomics — there are too many size-by-prop combinations to enumerate as attribute
  rules.
- `style` is emitted **last** in JSX so caller-side `data-*` from `...rest` cannot accidentally
  override it. (Public API forbids `style`/`className` via `Omit`, so callers can't pass them
  anyway, but the layered emit still feels right.)
- `data-type="toolbar"` etc. coming through `...rest` correctly override Panel's own
  `data-type="panel"` because of JSX later-wins ordering.
- Caller's `data-direction`, `data-bg`, etc. coming through `...rest` will *also* override —
  intentional, lets specialized wrappers (Toolbar) re-label.

### Step 3 — Update `Panel.story.tsx`

Replace [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx)
with a story exposing the new prop surface. Storybook's `enum`/`boolean`/`number` prop types
already support most of what we need.

```tsx
import React from "react";
import { Panel } from "./Panel";
import { Story } from "../../editors/storybook/storyTypes";

const SIZES = ["none", "xs", "sm", "md", "lg", "xl", "xxl"];
const ALIGNS = ["start", "center", "end", "stretch", "baseline"];
const JUSTIFIES = ["start", "center", "end", "between", "around", "evenly"];
const DIRECTIONS = ["row", "column", "row-reverse", "column-reverse"];
const OVERFLOWS = ["visible", "hidden", "auto", "scroll"];

export const panelStory: Story = {
    id: "panel",
    name: "Panel",
    section: "Layout",
    component: Panel as any,
    props: [
        { name: "direction",   type: "enum",    options: DIRECTIONS, default: "row" },
        { name: "padding",     type: "enum",    options: SIZES, default: "md" },
        { name: "gap",         type: "enum",    options: SIZES, default: "sm" },
        { name: "align",       type: "enum",    options: [...ALIGNS, ""], default: "" },
        { name: "justify",     type: "enum",    options: [...JUSTIFIES, ""], default: "" },
        { name: "wrap",        type: "boolean", default: false },
        { name: "border",      type: "boolean", default: false },
        { name: "borderTop",   type: "boolean", default: false },
        { name: "borderBottom",type: "boolean", default: false },
        { name: "rounded",     type: "enum",    options: [...SIZES, ""], default: "" },
        { name: "shadow",      type: "boolean", default: false },
        { name: "background",  type: "enum",    options: ["", "default", "light", "dark"], default: "" },
        { name: "overflow",    type: "enum",    options: ["", ...OVERFLOWS], default: "" },
        { name: "disabled",    type: "boolean", default: false },
    ],
    previewChildren: () => React.createElement(React.Fragment, null,
        React.createElement("span", { key: "a" }, "Child A"),
        React.createElement("span", { key: "b" }, "Child B"),
        React.createElement("span", { key: "c" }, "Child C"),
    ),
};
```

**Implementation note:** the storybook editor maps empty-string enum values to `undefined`
when passing through `componentProps`. If it doesn't, add a small filter inside `LivePreview`
that drops `""` enum values. (Verify by manual test in Step 11.) If filtering is needed, add
the rule: `if (componentProps[key] === "") delete componentProps[key];` in
`src/renderer/editors/storybook/LivePreview.tsx` near where managed props are injected.

### Step 4 — Refactor `Toolbar` to compose `Panel`

Replace [src/renderer/uikit/Toolbar/Toolbar.tsx](../../../src/renderer/uikit/Toolbar/Toolbar.tsx)
with the implementation below. The roving-tabindex hook (`useRovingTabIndex`, `findFocusable`)
is **unchanged** — copy it byte-for-byte from the current file.

The structural changes:

1. Drop the `styled.div` `Root` — Toolbar's layout is now Panel's job.
2. Drop the `&:empty { display: none }` rule. (Storybook editor and other modern callers
   guard their own empty toolbars with `{condition && <Toolbar>…</Toolbar>}`. The legacy
   PageToolbar behavior was defensive and is no longer relied on.)
3. Apply `disabled` styling via Panel's new `disabled` prop.
4. Apply background / borderTop / borderBottom via Panel props.
5. Apply orientation-dependent layout (direction, paddings, gap) via Panel props.
6. `data-type="toolbar"`, `data-roving-host=""`, and `data-orientation` flow through
   `...rest` — JSX later-wins makes them override Panel's own `data-type="panel"`.

```tsx
import React from "react";
import { Panel } from "../Panel/Panel";

// --- Types ---

export interface ToolbarProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    orientation?: "horizontal" | "vertical";
    background?: "default" | "light" | "dark";
    borderTop?: boolean;
    borderBottom?: boolean;
    disabled?: boolean;
    "aria-label"?: string;
}

// --- Roving tabindex helper (Rule 4) ---
// (Unchanged from current Toolbar.tsx — copy `findFocusable` and `useRovingTabIndex` verbatim.)

function findFocusable(el: Element): HTMLElement | null { /* …existing implementation… */ return null; }

function useRovingTabIndex(
    rootRef: React.RefObject<HTMLDivElement | null>,
    orientation: "horizontal" | "vertical",
    disabled: boolean | undefined,
) {
    /* …existing implementation… */
    return {
        handleKey: (_e: React.KeyboardEvent) => {},
        handleFocusCapture: (_e: React.FocusEvent) => {},
    };
}

// --- Component ---

export function Toolbar({
    orientation = "horizontal",
    background = "dark",
    borderTop,
    borderBottom,
    disabled,
    children,
    onKeyDown,
    onFocusCapture,
    ...rest
}: ToolbarProps) {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const { handleKey, handleFocusCapture } = useRovingTabIndex(
        rootRef,
        orientation,
        disabled,
    );

    const isHorizontal = orientation === "horizontal";

    return (
        <Panel
            ref={rootRef}
            role="toolbar"
            aria-orientation={orientation}
            aria-disabled={disabled || undefined}
            data-type="toolbar"
            data-roving-host=""
            data-orientation={orientation}
            direction={isHorizontal ? "row" : "column"}
            align={isHorizontal ? "center" : "stretch"}
            gap="sm"
            paddingX={isHorizontal ? "sm" : "xs"}
            paddingY={isHorizontal ? "xs" : "sm"}
            overflow="hidden"
            shrink={false}
            background={background}
            borderTop={borderTop}
            borderBottom={borderBottom}
            disabled={disabled}
            onKeyDown={(e) => { handleKey(e); onKeyDown?.(e); }}
            onFocusCapture={(e) => { handleFocusCapture(e); onFocusCapture?.(e); }}
            {...rest}
        >
            {children}
        </Panel>
    );
}
```

The implementer **must preserve** the full `findFocusable` and `useRovingTabIndex`
implementations from the current file — they are well-tested and out of scope for this task.
The skeleton stubs above are placeholders for clarity only.

### Step 5 — Extend `Button` with a `block` prop

The Storybook editor's `ComponentBrowser` currently does:

```tsx
<Button style={{ width: "100%", justifyContent: "flex-start" }}>{story.name}</Button>
```

The `justifyContent: "flex-start"` is redundant — Button's flex children naturally left-align
because Button's CSS sets no `justify-content`. Drop it. The remaining need is `width: 100%`,
exposed as a new `block?: boolean` prop.

In [src/renderer/uikit/Button/Button.tsx](../../../src/renderer/uikit/Button/Button.tsx):

**Add to `ButtonProps`:**

```tsx
/** Stretch to the full width of the parent. */
block?: boolean;
```

**Add to `Root` styled definition** (alongside the existing `data-size` rules):

```tsx
"&[data-block]": {
    display: "flex",
    width: "100%",
},
```

**Add to JSX:**

```tsx
<Root
    /* …existing attrs… */
    data-block={block || undefined}
    /* …existing attrs… */
>
```

**Update the destructuring** in `Button` to pull `block` out of props.

No other Button changes.

### Step 6 — Migrate the Storybook editor (lighthouse)

Four files in [src/renderer/editors/storybook/](../../../src/renderer/editors/storybook/) lose
all `styled.*` and `style=` usage. Each migration replaces app-side styling with Panel props.

#### 6a. `StorybookEditorView.tsx`

Replace [src/renderer/editors/storybook/StorybookEditorView.tsx](../../../src/renderer/editors/storybook/StorybookEditorView.tsx)
with:

```tsx
import React from "react";
import { EditorType } from "../../../shared/types";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { Panel } from "../../uikit/Panel/Panel";
import { Toolbar } from "../../uikit/Toolbar/Toolbar";
import { SegmentedControl } from "../../uikit/SegmentedControl/SegmentedControl";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { Text } from "../../uikit/Text/Text";
import {
    PreviewBackground,
    StorybookEditorModel,
    StorybookEditorState,
    getDefaultStorybookEditorState,
    STORYBOOK_PAGE_ID,
} from "./StorybookEditorModel";
import { ComponentBrowser } from "./ComponentBrowser";
import { LivePreview } from "./LivePreview";
import { PropertyEditor } from "./PropertyEditor";

const BG_OPTIONS: Array<{ value: PreviewBackground; label: string }> = [
    { value: "dark",    label: "Dark"    },
    { value: "default", label: "Default" },
    { value: "light",   label: "Light"   },
];

function StorybookEditorView({ model }: { model: StorybookEditorModel }) {
    const { previewBackground } = model.state.use();
    return (
        <Panel
            data-type="storybook-editor"
            direction="column"
            flex
            overflow="hidden"
        >
            <Toolbar borderBottom aria-label="Storybook editor toolbar">
                <Panel paddingLeft="sm" paddingRight="md">
                    <Text variant="heading">Storybook</Text>
                </Panel>
                <Spacer />
                <Text variant="caption">Background:</Text>
                <SegmentedControl
                    items={BG_OPTIONS}
                    value={previewBackground}
                    onChange={(v) => model.setPreviewBackground(v as PreviewBackground)}
                    size="sm"
                />
            </Toolbar>
            <Panel direction="row" flex overflow="hidden">
                <ComponentBrowser model={model} />
                <LivePreview model={model} />
                <PropertyEditor model={model} />
            </Panel>
        </Panel>
    );
}

const storybookEditorModule: EditorModule = {
    Editor: StorybookEditorView as any,

    newEditorModel: async () => {
        return new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState()));
    },

    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "storybookPage") return null;
        return new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState()));
    },

    newEditorModelFromState: async (state) => {
        const s: StorybookEditorState = {
            ...getDefaultStorybookEditorState(),
            ...(state as Partial<StorybookEditorState>),
        };
        return new StorybookEditorModel(new TComponentState(s));
    },
};

export default storybookEditorModule;
export { STORYBOOK_PAGE_ID };
```

**What changed vs current:**

- `Root`/`Body`/`ToolbarTitle` styled components removed.
- Outer flex column → `<Panel direction="column" flex overflow="hidden">`.
- Body row → `<Panel direction="row" flex overflow="hidden">`.
- `<ToolbarTitle>` → `<Panel paddingLeft="sm" paddingRight="md"><Text variant="heading">…`
  (asymmetric padding is exactly what the side-specific padding props are for).
- `<HStack>` wrapping the right group is gone; `<Spacer />` pushes the SegmentedControl group
  to the right of the toolbar via flex grow.
- The Text now uses `variant="heading"` instead of an inline-styled span; this matches the
  intent of the original 13px / 600 weight title.
- All emotion imports gone.

#### 6b. `ComponentBrowser.tsx`

Replace [src/renderer/editors/storybook/ComponentBrowser.tsx](../../../src/renderer/editors/storybook/ComponentBrowser.tsx)
with:

```tsx
import React from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { Button } from "../../uikit/Button/Button";
import { Label } from "../../uikit/Label/Label";
import { storiesBySection } from "./storyRegistry";
import { StorybookEditorModel } from "./StorybookEditorModel";

export function ComponentBrowser({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId } = model.state.use();
    const sections = storiesBySection();

    return (
        <Panel
            data-type="component-browser"
            direction="column"
            width={200}
            shrink={false}
            overflowY="auto"
            borderRight
            borderColor="default"
            padding="sm"
            gap="xs"
        >
            {Array.from(sections.entries()).map(([section, stories]) => (
                <React.Fragment key={section}>
                    <Panel paddingTop="sm" paddingBottom="xs" paddingLeft="xs">
                        <Label variant="section">{section}</Label>
                    </Panel>
                    {stories.map((story) => (
                        <Button
                            key={story.id}
                            block
                            variant={selectedStoryId === story.id ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => model.selectStory(story.id)}
                        >
                            {story.name}
                        </Button>
                    ))}
                </React.Fragment>
            ))}
        </Panel>
    );
}
```

**What changed:**

- `Root` styled.div → `<Panel ... borderRight borderColor="default">` with width/shrink/overflow.
- `SectionLabel` styled(Label) → wrap Label in a Panel that owns the asymmetric padding.
- Button's `style={{ width: "100%", justifyContent: "flex-start" }}` → `block` prop only;
  `flex-start` is the default Button content alignment so no replacement is needed.

#### 6c. `LivePreview.tsx`

Replace [src/renderer/editors/storybook/LivePreview.tsx](../../../src/renderer/editors/storybook/LivePreview.tsx)
with:

```tsx
import React from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { Text } from "../../uikit/Text/Text";
import { findStory } from "./storyRegistry";
import { STORYBOOK_MANAGED_PROPS } from "./storyTypes";
import { StorybookEditorModel } from "./StorybookEditorModel";

export function LivePreview({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, propValues, previewBackground } = model.state.use();
    const story = findStory(selectedStoryId);

    if (!story) {
        return (
            <Panel
                data-type="live-preview"
                flex
                overflow="auto"
                align="center"
                justify="center"
                padding="xl"
                background={previewBackground}
            >
                <Text variant="caption">Select a component</Text>
            </Panel>
        );
    }

    const Component = story.component as React.ComponentType<any>;
    const hasChildrenProp = story.props.some((p) => p.name === "children");
    const componentProps: Record<string, unknown> = { ...propValues };

    // Drop empty-string enum values so they don't override component defaults.
    for (const key of Object.keys(componentProps)) {
        if (componentProps[key] === "") delete componentProps[key];
    }

    if (!hasChildrenProp && story.previewChildren) {
        componentProps.children = story.previewChildren();
    }
    // Auto-inject Storybook-managed values (e.g. background) when the
    // component's story declares the matching prop.
    const managedValues: Record<string, unknown> = { background: previewBackground };
    for (const propName of STORYBOOK_MANAGED_PROPS) {
        if (story.props.some((p) => p.name === propName)) {
            componentProps[propName] = managedValues[propName];
        }
    }

    return (
        <Panel
            data-type="live-preview"
            flex
            overflow="auto"
            align="center"
            justify="center"
            padding="xl"
            background={previewBackground}
        >
            <Component {...componentProps} />
        </Panel>
    );
}
```

**What changed:**

- `Root` styled.div → `<Panel flex overflow="auto" align="center" justify="center" padding="xl" background={previewBackground}>`.
- The data-bg attribute selector is replaced by Panel's `background` prop (same three values).
- Empty-string enum values from the property editor are filtered before being passed to the
  component (covers Step 3's caveat about Panel's optional enum props).

#### 6d. `PropertyEditor.tsx`

Replace [src/renderer/editors/storybook/PropertyEditor.tsx](../../../src/renderer/editors/storybook/PropertyEditor.tsx)
with:

```tsx
import React from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { Button } from "../../uikit/Button/Button";
import { Input } from "../../uikit/Input/Input";
import { Label } from "../../uikit/Label/Label";
import { Checkbox } from "../../uikit/Checkbox/Checkbox";
import { Text } from "../../uikit/Text/Text";
import { ICON_PRESETS } from "./iconPresets";
import { PropDef, STORYBOOK_MANAGED_PROPS } from "./storyTypes";
import { StorybookEditorModel } from "./StorybookEditorModel";
import { findStory } from "./storyRegistry";

function PropRow({ def, value, onChange }: {
    def: PropDef;
    value: unknown;
    onChange: (v: unknown) => void;
}) {
    const label = def.label ?? def.name;

    if (def.type === "boolean") {
        return (
            <Checkbox
                checked={Boolean(value)}
                onChange={(v) => onChange(v)}
            >
                {label}
            </Checkbox>
        );
    }

    if (def.type === "string") {
        return (
            <Panel direction="column" gap="xs">
                <Label>{label}</Label>
                <Input
                    value={String(value ?? "")}
                    onChange={(v) => onChange(v)}
                    size="sm"
                    placeholder={def.placeholder}
                />
            </Panel>
        );
    }

    if (def.type === "number") {
        return (
            <Panel direction="column" gap="xs">
                <Label>{label}</Label>
                <Input
                    value={String(value ?? "")}
                    onChange={(v) => {
                        const n = Number(v);
                        if (!isNaN(n)) onChange(n);
                    }}
                    size="sm"
                    type="number"
                    min={def.min}
                    max={def.max}
                    step={def.step}
                />
            </Panel>
        );
    }

    if (def.type === "enum") {
        return (
            <Panel direction="column" gap="xs">
                <Label>{label}</Label>
                <Panel direction="row" wrap gap="xs">
                    {def.options.map((opt) => (
                        <Button
                            key={opt}
                            size="sm"
                            variant={value === opt ? "primary" : "link"}
                            onClick={() => onChange(opt)}
                        >
                            {opt}
                        </Button>
                    ))}
                </Panel>
            </Panel>
        );
    }

    if (def.type === "icon") {
        return (
            <Panel direction="column" gap="xs">
                <Label>{label}</Label>
                <Panel direction="row" wrap gap="xs">
                    {ICON_PRESETS.map((preset) => (
                        <Button
                            key={preset.id}
                            size="sm"
                            variant={value === preset.id ? "primary" : "link"}
                            onClick={() => onChange(preset.id)}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </Panel>
            </Panel>
        );
    }

    return null;
}

export function PropertyEditor({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, propValues } = model.state.use();
    const story = findStory(selectedStoryId);
    const visibleProps = story?.props.filter((p) => !STORYBOOK_MANAGED_PROPS.has(p.name)) ?? [];

    if (!story || visibleProps.length === 0) {
        return (
            <Panel
                data-type="property-editor"
                direction="column"
                width={280}
                shrink={false}
                overflowY="auto"
                borderLeft
                borderColor="default"
                padding="md"
            >
                <Panel padding="md">
                    <Text variant="caption">No editable props</Text>
                </Panel>
            </Panel>
        );
    }

    return (
        <Panel
            data-type="property-editor"
            direction="column"
            width={280}
            shrink={false}
            overflowY="auto"
            borderLeft
            borderColor="default"
            padding="md"
            gap="md"
        >
            {visibleProps.map((def) => (
                <PropRow
                    key={def.name}
                    def={def}
                    value={propValues[def.name]}
                    onChange={(v) => model.setPropValue(def.name, v)}
                />
            ))}
            <Panel align="start">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={model.resetProps}
                >
                    Reset Props
                </Button>
            </Panel>
        </Panel>
    );
}
```

**What changed:**

- `Root` styled.div → outer Panel with width/shrink/overflow/border/padding/gap props.
- `EmptyMessage` styled.div → `<Panel padding="md"><Text variant="caption">…`.
- All `<VStack gap={gap.xs}>` and `<Flex wrap gap={gap.xs}>` → `<Panel direction="column" gap="xs">`
  / `<Panel direction="row" wrap gap="xs">`.
- The reset button's `style={{ marginTop: spacing.md, alignSelf: "flex-start" }}` →
  `<Panel align="start"><Button>Reset Props</Button></Panel>`. The `marginTop` is dropped;
  the parent Panel's `gap="md"` provides equivalent spacing (~8px instead of the prior 16px).
  This is a minor visual change accepted in the migration.

### Step 7 — Update `Spacer.story.tsx` and `Divider.story.tsx`

These two stories currently import `HStack`/`VStack` from the soon-to-be-deleted Flex folder.

#### 7a. `Spacer.story.tsx`

Replace [src/renderer/uikit/Spacer/Spacer.story.tsx](../../../src/renderer/uikit/Spacer/Spacer.story.tsx)
with:

```tsx
import React from "react";
import { Spacer } from "./Spacer";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const SpacerInPreview = (props: any) => {
    const { size, ...rest } = props;
    return React.createElement(
        Panel,
        {
            direction: "row",
            gap: "sm",
            align: "center",
            width: 240,
            padding: "md",
            border: true,
        },
        React.createElement("span", { key: "l" }, "Left"),
        React.createElement(Spacer, { ...rest, size: size || undefined }),
        React.createElement("span", { key: "r" }, "Right"),
    );
};

export const spacerStory: Story = {
    id: "spacer",
    name: "Spacer",
    section: "Layout",
    component: SpacerInPreview,
    props: [
        { name: "size", type: "number", default: 0, min: 0, max: 120, step: 8, label: "size (0 = flex grow)" },
    ],
};
```

The previous dashed border becomes a solid border (Panel only emits solid borders). Visually
near-identical for a story preview.

#### 7b. `Divider.story.tsx`

Replace [src/renderer/uikit/Divider/Divider.story.tsx](../../../src/renderer/uikit/Divider/Divider.story.tsx)
with:

```tsx
import React from "react";
import { Divider } from "./Divider";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const DividerInPreview = ({ orientation }: { orientation?: "horizontal" | "vertical" }) => {
    if (orientation === "vertical") {
        return React.createElement(
            Panel,
            { direction: "row", gap: "xl", align: "center", height: 80, padding: "xl" },
            React.createElement("span", { key: "l" }, "Left"),
            React.createElement(Divider, { orientation: "vertical" }),
            React.createElement("span", { key: "r" }, "Right"),
        );
    }
    return React.createElement(
        Panel,
        { direction: "column", gap: "lg", width: 200, padding: "xl" },
        React.createElement("span", { key: "a" }, "Above"),
        React.createElement(Divider, { orientation: "horizontal" }),
        React.createElement("span", { key: "b" }, "Below"),
    );
};

export const dividerStory: Story = {
    id: "divider",
    name: "Divider",
    section: "Bootstrap",
    component: DividerInPreview as any,
    props: [
        { name: "orientation", type: "enum", options: ["horizontal", "vertical"], default: "horizontal" },
    ],
};
```

(`gap: 12` → `gap.xl` (12px); `gap: 8` → `gap.lg` (8px); `padding: 16` → `spacing.xl` (16px).
Token mappings exact.)

### Step 8 — Delete the `Flex/` folder

Remove the following files entirely:

- `src/renderer/uikit/Flex/Flex.tsx`
- `src/renderer/uikit/Flex/Flex.story.tsx`
- `src/renderer/uikit/Flex/HStack.story.tsx`
- `src/renderer/uikit/Flex/VStack.story.tsx`
- `src/renderer/uikit/Flex/index.ts`

Then delete the empty `src/renderer/uikit/Flex/` directory.

### Step 9 — Delete the `Card/` folder

Remove the following files entirely:

- `src/renderer/uikit/Card/Card.tsx`
- `src/renderer/uikit/Card/Card.story.tsx`
- `src/renderer/uikit/Card/index.ts`

Then delete the empty `src/renderer/uikit/Card/` directory.

The "Card" preset is now expressed as `<Panel rounded="lg" shadow padding="xl">` directly
where needed. No Card story replacement — see Concern #1 below for the open question.

### Step 10 — Update `uikit/index.ts`

Replace [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) with:

```tsx
// UIKit — Persephone component library
// Components are exported here as they are implemented.
// See CLAUDE.md in this folder for authoring rules.

// Layout primitives
export { Panel } from "./Panel";
export type { PanelProps } from "./Panel";
export { Spacer } from "./Spacer";
export type { SpacerProps } from "./Spacer";
export { Toolbar } from "./Toolbar";
export type { ToolbarProps } from "./Toolbar";

// Bootstrap components (US-440)
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { Input } from "./Input";
export type { InputProps } from "./Input";
export { Label } from "./Label";
export type { LabelProps } from "./Label";
export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";
export { Divider } from "./Divider";
export type { DividerProps } from "./Divider";
export { Text } from "./Text";
export type { TextProps } from "./Text";
export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlProps } from "./SegmentedControl";
```

**What changed:**

- Removed `export { Flex, HStack, VStack } from "./Flex"` and the matching type export.
- Removed `export { Card } from "./Card"` and the matching type export.
- Added `SegmentedControl` exports (these were missing from the current index.ts but are
  used outside the uikit folder — small drive-by fix).

### Step 11 — Update `storyRegistry.ts`

Replace [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts)
with:

```tsx
import { Story } from "./storyTypes";

// Layout
import { panelStory }   from "../../uikit/Panel/Panel.story";
import { spacerStory }  from "../../uikit/Spacer/Spacer.story";
import { toolbarStory } from "../../uikit/Toolbar/Toolbar.story";

// Bootstrap
import { buttonStory }           from "../../uikit/Button/Button.story";
import { iconButtonStory }       from "../../uikit/IconButton/IconButton.story";
import { inputStory }            from "../../uikit/Input/Input.story";
import { labelStory }            from "../../uikit/Label/Label.story";
import { checkboxStory }         from "../../uikit/Checkbox/Checkbox.story";
import { dividerStory }          from "../../uikit/Divider/Divider.story";
import { textStory }             from "../../uikit/Text/Text.story";
import { segmentedControlStory } from "../../uikit/SegmentedControl/SegmentedControl.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory,
];

export function findStory(id: string): Story | undefined {
    return ALL_STORIES.find((s) => s.id === id);
}

export function storiesBySection(): Map<string, Story[]> {
    const out = new Map<string, Story[]>();
    for (const s of ALL_STORIES) {
        const list = out.get(s.section) ?? [];
        list.push(s);
        out.set(s.section, list);
    }
    return out;
}
```

**What changed:**

- Removed imports and registrations for `flexStory`, `hstackStory`, `vstackStory`, `cardStory`.
- All other stories preserved.

### Step 12 — Update dashboard and EPIC-025 task table

In [doc/active-work.md](../../active-work.md), insert after the existing `US-450` line under
`EPIC-025`:

```markdown
  - [ ] [US-451: UIKit layout refactor — unified Panel + Storybook lighthouse](tasks/US-451-uikit-panel-refactor/README.md) *(Phase 3 polish)*
```

In [doc/epics/EPIC-025.md](../../epics/EPIC-025.md), insert a new row in the **Linked Tasks**
table after the `US-450` row:

```markdown
| [US-451](../tasks/US-451-uikit-panel-refactor/README.md) | UIKit layout refactor — unified Panel + Storybook lighthouse | Phase 3 polish / Active |
```

## Concerns / Open Questions

### Resolved

1. **Disposition of existing Panel and Card** — Resolved. Collapse both into the new unified
   Panel via props. The current Panel preset is `<Panel border padding="md" rounded="md">`;
   the current Card preset is `<Panel rounded="lg" shadow padding="xl">`. Delete both old
   folders.

2. **Default direction** — Resolved. `direction="row"` matches the CSS `flex-direction`
   default. Inheriting CSS defaults is least surprising.

3. **Type-level enforcement of "no `style`/`className`"** — Resolved. PanelProps and
   ToolbarProps both `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">`. App
   code that tries to pass them gets a TypeScript error. Other UIKit components keep their
   existing extends until per-component migration in Phase 4 (Button etc.) — this is a phased
   rollout, not a regression.

4. **Padding granularity** — Resolved. Support all 7 props: `padding`, `paddingX`, `paddingY`,
   `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`. Specificity: side > axis > all.
   Justified by ToolbarTitle (paddingLeft=sm, paddingRight=md) and SectionLabel
   (paddingTop=sm, paddingBottom=xs, paddingLeft=xs).

5. **Border color** — Resolved. `borderColor?: "subtle" | "default"` defaulting to "subtle"
   (color.border.light). Sidebars use "default" (color.border.default) to match their current
   visual.

6. **Toolbar `:empty { display: none }` rule** — Resolved. **Drop**. Modern callers guard
   their own conditional toolbars (`{condition && <Toolbar>…}`); the legacy defensive rule
   from PageToolbar is no longer relied on. This avoids the pseudo-class CSS dependency that
   would otherwise force a `styled(Panel)` wrapper.

7. **PropertyEditor reset button extra `marginTop`** — Resolved. Drop. Rely on parent Panel's
   `gap="md"` for spacing. ~8px less vertical space above "Reset Props" than the previous
   layout. Acceptable visual change.

8. **Migration of legacy editors (PageToolbar etc.)** — Out of scope. Storybook editor is the
   sole lighthouse for this task. Per-editor migration of legacy `PageToolbar` and other
   styled-heavy editors is deferred to per-component tasks in Phase 4.

9. **Disabled state on Panel** — Resolved. Add `disabled?: boolean` to PanelProps with
   `data-disabled` attribute selector applying `opacity: 0.6, pointer-events: none`. Toolbar
   passes through. Button/Label keep their own disabled styling (different opacities) — Panel's
   `disabled` is for *region-level* disabling (a whole sidebar, a whole toolbar).

10. **Empty-string enum filtering in LivePreview** — Resolved. Added an explicit filter loop
    in LivePreview that drops `componentProps[key] === ""`. This unblocks Panel.story's
    optional enum props (align, justify, rounded, etc.) where "no value" should fall back to
    the component default.

11. **Card story** — Resolved. Drop entirely. The unified Panel story already covers the same
    visual range when the user enables `shadow + rounded="lg" + padding="xl"`. No separate
    "Card preset" entry. `uikit/Card/` folder is fully deleted (Card.tsx, Card.story.tsx,
    index.ts, then the empty directory).

## Acceptance Criteria

- [ ] No imports of `Flex`, `HStack`, `VStack`, or `Card` anywhere in `src/`. (`grep -r "HStack\|VStack\|/Flex\b\|/Card\b" src/` returns nothing.)
- [ ] No `styled.*`, `style=`, or `className=` usage in `src/renderer/editors/storybook/`. (`grep -r "styled\.\|style=\|className=" src/renderer/editors/storybook/` returns nothing — except possibly inside scripts/test files that are not changed by this task.)
- [ ] `src/renderer/uikit/CLAUDE.md` contains the new "Rule 7 — No Emotion outside UIKit" section.
- [ ] `src/renderer/uikit/Flex/` directory is deleted.
- [ ] `src/renderer/uikit/Card/` directory is deleted.
- [ ] `src/renderer/uikit/Panel/Panel.tsx` exposes the unified API (`direction`, `padding`, `paddingX`/`Y`/`Top`/`Bottom`/`Left`/`Right`, `gap`, `align`, `justify`, `flex`, `shrink`, `wrap`, `width`, `height`, `overflow`/`X`/`Y`, `border`/`Top`/`Bottom`/`Left`/`Right`, `borderColor`, `rounded`, `shadow`, `background`, `disabled`).
- [ ] PanelProps and ToolbarProps both `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">` (verify: TypeScript errors when you try `<Panel style={…}>` or `<Toolbar className=…>`).
- [ ] `Toolbar.tsx` no longer uses `styled.*` directly; it composes `Panel` for layout.
- [ ] `Button.tsx` exposes the new `block?: boolean` prop and applies `data-block` styling.
- [ ] `tsc --noEmit` shows no new errors in any of the changed files.
- [ ] `eslint` shows no new errors in any of the changed files (existing pre-existing warnings tolerated).
- [ ] Manual smoke test in `npm start`:
    - [ ] Storybook editor opens, Toolbar renders correctly with title "Storybook" left-aligned and Background SegmentedControl right-aligned.
    - [ ] ComponentBrowser sidebar shows section labels and story buttons; selected story is highlighted; buttons stretch to sidebar width.
    - [ ] LivePreview switches background among Default / Light / Dark via the SegmentedControl.
    - [ ] PropertyEditor renders prop rows; Reset Props button works.
    - [ ] Panel story shows up under "Layout" with the rich prop surface; toggling props updates the live preview.
    - [ ] Toolbar story still shows its demo with roving tabindex working (Tab in, Arrow keys move focus, Tab out).
    - [ ] Spacer and Divider stories still render with their layout demos.
    - [ ] All other UIKit stories (Button, IconButton, Input, etc.) are unaffected.
- [ ] [doc/active-work.md](../../active-work.md) lists US-451 under EPIC-025.
- [ ] [doc/epics/EPIC-025.md](../../epics/EPIC-025.md) Linked Tasks table has a row for US-451.

## Files NOT Changed

The agent doing the implementation should not investigate or modify these files — they are
unrelated to this task:

- `src/renderer/editors/storybook/StorybookEditorModel.ts` — model layer, no rendering.
- `src/renderer/editors/storybook/storyTypes.ts` — types only.
- `src/renderer/editors/storybook/iconPresets.ts` — data only.
- `src/renderer/uikit/Spacer/Spacer.tsx` — already uses inline style on raw `<span>`,
  consistent with the rule (UIKit-internal raw-HTML inline style is allowed).
- `src/renderer/uikit/Text/Text.tsx`, `Label/Label.tsx`, `Input/Input.tsx`,
  `Checkbox/Checkbox.tsx`, `Divider/Divider.tsx`, `IconButton/IconButton.tsx`,
  `SegmentedControl/SegmentedControl.tsx` — bootstrap components untouched (no Flex/HStack/VStack
  usage internally; Storybook lighthouse wraps them with Panel rather than mutating them).
- `src/renderer/theme/color.ts` and `src/renderer/theme/themes/*` — no new colors needed.
  Panel uses `color.border.light`, `color.border.default`, `color.background.{default,light,dark}`,
  `color.shadow.default` — all already present.
- `src/renderer/uikit/tokens.ts` — no new tokens. Panel's `Size = "none"|"xs"|"sm"|"md"|"lg"|"xl"|"xxl"`
  uses the existing `spacing`, `gap`, and `radius` scales as-is. `"none"` is mapped to 0 inline.
- All editor implementations outside the storybook folder (text, grid, markdown, etc.). They
  continue using their existing `PageToolbar` and styled components until per-editor migration
  tasks in Phase 4.

## Files Changed Summary

| Path | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/CLAUDE.md` | EDIT | Add "Rule 7 — No Emotion outside UIKit" section |
| `src/renderer/uikit/Panel/Panel.tsx` | REWRITE | New unified API (~30 props) |
| `src/renderer/uikit/Panel/Panel.story.tsx` | REWRITE | Demonstrate new API |
| `src/renderer/uikit/Toolbar/Toolbar.tsx` | EDIT | Replace `styled.div` Root with composed `Panel`; preserve roving-tabindex hook |
| `src/renderer/uikit/Button/Button.tsx` | EDIT | Add `block?: boolean` prop + `[data-block]` style |
| `src/renderer/uikit/Spacer/Spacer.story.tsx` | EDIT | Replace HStack with Panel |
| `src/renderer/uikit/Divider/Divider.story.tsx` | EDIT | Replace HStack/VStack with Panel |
| `src/renderer/uikit/Flex/Flex.tsx` | DELETE | |
| `src/renderer/uikit/Flex/Flex.story.tsx` | DELETE | |
| `src/renderer/uikit/Flex/HStack.story.tsx` | DELETE | |
| `src/renderer/uikit/Flex/VStack.story.tsx` | DELETE | |
| `src/renderer/uikit/Flex/index.ts` | DELETE | |
| `src/renderer/uikit/Flex/` | DELETE | Directory after files removed |
| `src/renderer/uikit/Card/Card.tsx` | DELETE | |
| `src/renderer/uikit/Card/Card.story.tsx` | DELETE | |
| `src/renderer/uikit/Card/index.ts` | DELETE | |
| `src/renderer/uikit/Card/` | DELETE | Directory after files removed |
| `src/renderer/uikit/index.ts` | EDIT | Drop Flex/HStack/VStack/Card; add SegmentedControl |
| `src/renderer/editors/storybook/StorybookEditorView.tsx` | REWRITE | Pure UIKit composition |
| `src/renderer/editors/storybook/ComponentBrowser.tsx` | REWRITE | Pure UIKit composition |
| `src/renderer/editors/storybook/LivePreview.tsx` | REWRITE | Pure UIKit composition + empty-string filter |
| `src/renderer/editors/storybook/PropertyEditor.tsx` | REWRITE | Pure UIKit composition |
| `src/renderer/editors/storybook/storyRegistry.ts` | EDIT | Drop flex/hstack/vstack/card stories |
| `doc/active-work.md` | EDIT | Add US-451 entry under EPIC-025 |
| `doc/epics/EPIC-025.md` | EDIT | Add US-451 row to Linked Tasks table |
