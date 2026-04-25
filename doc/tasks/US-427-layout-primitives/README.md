# US-427: Layout Primitives — Flex, HStack, VStack, Panel, Card, Spacer

## Goal

Create six layout primitive components in the new UIKit folder (`src/renderer/uikit/`). These replace 100+ inline `styled.div` flex containers scattered across the codebase with composable, token-based layout components. Phase 1 = new code only — no existing code is modified or migrated.

## Background

### Dependencies (all complete)
- **US-439** — UIKit folder and [CLAUDE.md](../../src/renderer/uikit/CLAUDE.md) authoring guide exist
- **US-426** — Design tokens in [tokens.ts](../../src/renderer/uikit/tokens.ts) (spacing, gap, radius, height, fontSize)
- **US-438** — Pattern research complete; naming table finalized

### What exists today
- **FlexSpace** — [`src/renderer/components/layout/Elements.tsx`](../../src/renderer/components/layout/Elements.tsx): `styled.span({ flex: '1 1 auto' })`. This is what Spacer replaces (but no migration in this task).
- **123 files** contain inline `display: flex` styled definitions with hardcoded gap/padding/direction values. HStack, VStack, and Flex will eventually replace these (Phase 4).
- **Panel-like patterns** exist in CollapsiblePanelStack.tsx, EditorErrorBoundary.tsx, and others — bordered/padded containers with `color.background.default` + `color.border.light`.
- **Color system** — [`src/renderer/theme/color.ts`](../../src/renderer/theme/color.ts) provides CSS custom property tokens: `color.background.default`, `color.background.light`, `color.border.light`, `color.shadow.default`, etc.

### Rules from UIKit CLAUDE.md
- `data-type` on every root element (kebab-case)
- `data-*` state attributes, not CSS classes
- Design tokens from `tokens.ts` for all spacing/sizing
- Colors from `color.ts` only
- Emotion `styled.*` with `{ label: "Name" }` second arg
- Each component in its own subfolder with `index.ts`

## Implementation Plan

### Step 1 — Flex component family (Flex, HStack, VStack)

Create `src/renderer/uikit/Flex/Flex.tsx`:

**Props interface:**
```typescript
export interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Flex direction. Default: "row" */
    direction?: "row" | "column" | "row-reverse" | "column-reverse";
    /** Gap between children (px or string). Use gap.* tokens. */
    gap?: number | string;
    /** CSS align-items */
    align?: React.CSSProperties["alignItems"];
    /** CSS justify-content */
    justify?: React.CSSProperties["justifyContent"];
    /** Enable flex-wrap. `true` → "wrap", or pass explicit value. */
    wrap?: boolean | React.CSSProperties["flexWrap"];
    /** CSS flex shorthand (e.g. "1 1 auto") */
    flex?: React.CSSProperties["flex"];
    /** Padding (px or string). Use spacing.* tokens. */
    padding?: number | string;
}
```

**Styled root:**
```typescript
const Root = styled.div({
    display: "flex",
}, { label: "Flex" });
```

The Root only sets `display: flex`. All other properties (direction, gap, align, justify, wrap, flex, padding) are applied via the inline `style` prop, merged with any user-provided `style`. This is the standard approach for layout primitives where every prop value is dynamic.

**Component:**
```tsx
export function Flex({
    direction = "row",
    gap: gapProp,
    align,
    justify,
    wrap,
    flex: flexProp,
    padding: paddingProp,
    children,
    style,
    ...rest
}: FlexProps) {
    return (
        <Root
            data-type="flex"
            {...rest}
            style={{
                flexDirection: direction,
                gap: gapProp,
                alignItems: align,
                justifyContent: justify,
                flexWrap: wrap === true ? "wrap" : wrap || undefined,
                flex: flexProp,
                padding: paddingProp,
                ...style,
            }}
        >
            {children}
        </Root>
    );
}
```

**HStack and VStack** — thin wrappers in the same file:

```tsx
export type HStackProps = Omit<FlexProps, "direction">;
export type VStackProps = Omit<FlexProps, "direction">;

export function HStack(props: HStackProps) {
    return <Flex {...props} direction="row" />;
}

export function VStack(props: VStackProps) {
    return <Flex {...props} direction="column" />;
}
```

**`data-type` note:** HStack and VStack render as Flex internally, so they inherit `data-type="flex"`. The direction is visible via the inline `style` or via `data-direction` if we add it. Since the CLAUDE.md rule says "kebab-case matching the component name", we override data-type inside each wrapper:
- Flex → `data-type="flex"`
- HStack → pass a private `_dataType="h-stack"` to Flex (or override via `{...rest}`)
- VStack → pass a private `_dataType="v-stack"` to Flex

**Chosen approach:** Add an internal-only `dataType` parameter to the Root props so HStack/VStack can set their own identity without duplicating the entire render:

```tsx
export function Flex({
    direction = "row",
    // ... other props
    "data-type": explicitDataType,
    ...rest
}: FlexProps) {
    return (
        <Root
            data-type={explicitDataType ?? "flex"}
            {...rest}
            // ... style
        >
            {children}
        </Root>
    );
}

export function HStack(props: HStackProps) {
    return <Flex {...props} direction="row" data-type="h-stack" />;
}

export function VStack(props: VStackProps) {
    return <Flex {...props} direction="column" data-type="v-stack" />;
}
```

This works because `data-type` is a valid HTML attribute that passes through `...rest`.

Create `src/renderer/uikit/Flex/index.ts`:
```typescript
export { Flex, HStack, VStack } from "./Flex";
export type { FlexProps, HStackProps, VStackProps } from "./Flex";
```

### Step 2 — Panel component

Create `src/renderer/uikit/Panel/Panel.tsx`:

**Props interface:**
```typescript
export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Padding override. Default: spacing.md (8px). Use spacing.* tokens. */
    padding?: number | string;
    /** Gap between children. Use gap.* tokens. */
    gap?: number | string;
}
```

**Styled root:**
```typescript
const Root = styled.div({
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.background.default,
    border: `1px solid ${color.border.light}`,
    borderRadius: radius.md,
    padding: spacing.md,
}, { label: "Panel" });
```

Panel has sensible defaults (background, border, radius, padding) baked into the styled component. The `padding` and `gap` props allow overrides via inline style.

**Component:**
```tsx
export function Panel({
    padding: paddingProp,
    gap: gapProp,
    children,
    style,
    ...rest
}: PanelProps) {
    return (
        <Root
            data-type="panel"
            {...rest}
            style={{
                ...(paddingProp !== undefined && { padding: paddingProp }),
                ...(gapProp !== undefined && { gap: gapProp }),
                ...style,
            }}
        >
            {children}
        </Root>
    );
}
```

Create `src/renderer/uikit/Panel/index.ts`:
```typescript
export { Panel } from "./Panel";
export type { PanelProps } from "./Panel";
```

### Step 3 — Card component

Create `src/renderer/uikit/Card/Card.tsx`:

**Props interface:**
```typescript
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Padding override. Default: spacing.xl (16px). Use spacing.* tokens. */
    padding?: number | string;
    /** Gap between children. Use gap.* tokens. */
    gap?: number | string;
}
```

**Styled root:**
```typescript
const Root = styled.div({
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.background.default,
    borderRadius: radius.lg,
    boxShadow: `0 2px 8px ${color.shadow.default}`,
    padding: spacing.xl,
}, { label: "Card" });
```

Card is like Panel but uses shadow instead of border, larger radius, and more padding. This matches the "elevated surface" pattern seen in dialogs and floating containers.

**Component:** Same structure as Panel, with `data-type="card"`.

Create `src/renderer/uikit/Card/index.ts`.

### Step 4 — Spacer component

Create `src/renderer/uikit/Spacer/Spacer.tsx`:

**Props interface:**
```typescript
export interface SpacerProps {
    /** Fixed size in pixels. When omitted, Spacer fills available space (flex: 1 1 auto). */
    size?: number | string;
}
```

**Component (no styled root needed — pure inline style):**
```tsx
export function Spacer({ size }: SpacerProps) {
    if (size !== undefined) {
        return (
            <span
                data-type="spacer"
                style={{ flexBasis: size, flexGrow: 0, flexShrink: 0 }}
            />
        );
    }
    return (
        <span
            data-type="spacer"
            style={{ flex: "1 1 auto" }}
        />
    );
}
```

Spacer uses `<span>` (like existing FlexSpace) and never renders children. When `size` is given, it becomes a fixed-size gap using `flexBasis` + `flexShrink: 0`. When omitted, it fills all available space with `flex: 1 1 auto`.

Create `src/renderer/uikit/Spacer/index.ts`.

### Step 5 — Export from uikit/index.ts

Update `src/renderer/uikit/index.ts` to export all new components:

```typescript
// UIKit — Persephone component library
// Components are exported here as they are implemented.
// See CLAUDE.md in this folder for authoring rules.

// Layout primitives (US-427)
export { Flex, HStack, VStack } from "./Flex";
export type { FlexProps, HStackProps, VStackProps } from "./Flex";
export { Panel } from "./Panel";
export type { PanelProps } from "./Panel";
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { Spacer } from "./Spacer";
export type { SpacerProps } from "./Spacer";
```

## Concerns / Open Questions

1. **HStack/VStack data-type identity** — Should HStack render `data-type="h-stack"` (per CLAUDE.md rule: "kebab-case matching the component name") or `data-type="flex"` (since it's just a Flex alias)? **Proposed:** use distinct data-type values (`h-stack`, `v-stack`) for DevTools clarity, passed via the standard `data-type` HTML attribute.

2. **Panel vs Card defaults** — The proposed defaults (Panel: `spacing.md` padding, `radius.md`, border; Card: `spacing.xl` padding, `radius.lg`, shadow) are based on current codebase patterns. During Phase 4 migration, we may adjust. The `padding` and `gap` props allow per-instance overrides without new variants.

3. **No `overflow` prop on Flex** — Many existing inline styled.divs set `overflow: "hidden"`. This can be set via `style={{ overflow: "hidden" }}`. If migration reveals this is needed constantly, we can add it later.

4. **No `width`/`height` props on Flex** — Same reasoning as overflow. Available via `style` prop. Avoids prop explosion on a layout primitive.

## Acceptance Criteria

- [ ] `Flex` component with direction, gap, align, justify, wrap, flex, padding props
- [ ] `HStack` component — Flex preset with `direction="row"`, `data-type="h-stack"`
- [ ] `VStack` component — Flex preset with `direction="column"`, `data-type="v-stack"`
- [ ] `Panel` component with border, background, border-radius, padding defaults
- [ ] `Card` component with shadow, background, border-radius, padding defaults
- [ ] `Spacer` component — flexible space filler (default) or fixed-size gap
- [ ] All components use `data-type` on root element
- [ ] All components use design tokens from `tokens.ts` (not hardcoded values)
- [ ] All components use colors from `color.ts` (not hardcoded colors)
- [ ] Emotion styled definitions include `{ label: "Name" }` second argument
- [ ] Each component has its own subfolder with `index.ts`
- [ ] All components exported from `uikit/index.ts`
- [ ] Props interfaces exported for consumers
- [ ] No existing code is modified (Phase 1 = new code only)

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/Flex/Flex.tsx` | **Create** | Flex, HStack, VStack components + props |
| `src/renderer/uikit/Flex/index.ts` | **Create** | Re-exports |
| `src/renderer/uikit/Panel/Panel.tsx` | **Create** | Panel component + props |
| `src/renderer/uikit/Panel/index.ts` | **Create** | Re-exports |
| `src/renderer/uikit/Card/Card.tsx` | **Create** | Card component + props |
| `src/renderer/uikit/Card/index.ts` | **Create** | Re-exports |
| `src/renderer/uikit/Spacer/Spacer.tsx` | **Create** | Spacer component + props |
| `src/renderer/uikit/Spacer/index.ts` | **Create** | Re-exports |
| `src/renderer/uikit/index.ts` | **Edit** | Add exports for all new components |

### Files NOT changed
- `src/renderer/components/layout/Elements.tsx` — FlexSpace stays; migration is Phase 4
- `src/renderer/theme/color.ts` — all needed colors already exist
- `src/renderer/uikit/tokens.ts` — all needed tokens already exist
- `src/renderer/uikit/CLAUDE.md` — no rule changes needed
- No existing editor or UI files — Phase 1 is new code only
