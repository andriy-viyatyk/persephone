# US-467: UIKit Tooltip — overlay primitive

## Goal

Build a UIKit `Tooltip` component — a hover/focus-triggered floating label that screen migrations can use for rich tooltip content under [Rule 7](../../../src/renderer/uikit/CLAUDE.md). It is a thin UIKit wrapper around `@floating-ui/react` (the same library [US-466 Popover](../US-466-uikit-popover/README.md) uses), built on the **wrapper-with-cloneElement** pattern: `<Tooltip content="…">{trigger}</Tooltip>`. The trigger is a single React element whose ref is merged and whose mouseenter/mouseleave/focus/blur are intercepted to drive show/hide with delays.

Scope:

- **Build the Tooltip component** plus **integrate it into UIKit `Button` and `IconButton`** via a `title?: React.ReactNode` prop — when set, the button wraps itself in `<Tooltip content={title}>`; when unset, no tooltip rendering and zero cost. The native browser tooltip is suppressed (we omit the HTML `title` attribute from the spread). This is the primary design choice driving the task: buttons in Persephone almost always benefit from a tooltip clarifying their purpose, and the native browser tooltip looks inconsistent with the rest of the app's styling. Integrating it directly into Button / IconButton makes the common case (`<Button title="Save">…`) ergonomic without forcing every consumer to write `<Tooltip>` wrappers.
- **No legacy migrations here.** None of the four legacy tooltip implementations are migrated; they continue to use `react-tooltip` and migrate one-by-one as their parent screens reach Phase 4. The `react-tooltip` package stays in `package.json` until the last consumer is gone (separate cleanup task).
- **Rich content via ReactNode.** UIKit `Tooltip` and the `title` prop on Button / IconButton both accept `React.ReactNode`, so plain strings (`title="Save"`) and rich layouts (`title={<Panel>…</Panel>}`) both work without separate APIs.
- **Wrapper pattern as primary `Tooltip` API.** `<Tooltip content={node}><Trigger …/></Tooltip>` clones the single child to attach hover/focus handlers and merge refs. This is the idiomatic React pattern (Radix, MUI, Mantine all use it) and keeps trigger ↔ content co-located in JSX.

## Background

### EPIC-025 Phase 4 context

[EPIC-025](../../epics/EPIC-025.md) Phase 4 is per-screen migration, but several upcoming screens (LinkEditor's `LinksList` / `PinnedLinksPanel`, the graph editor's `GraphView`, the link-editor `LinkCategoryPanel`) need a rich-content floating label. Building UIKit `Tooltip` once is cheaper than reaching for legacy `react-tooltip` from each migration. This task pairs with [US-466 Popover](../US-466-uikit-popover/README.md) and the placeholder US-432 Dialog as the three pieces of overlay infrastructure that unblock the next several Phase 4 migrations.

Naming: the [US-438 naming table](../US-438-pattern-research/README.md) maps `OverflowTooltipText → TruncatedText` (a separate component, future task) but has no explicit entry for the standalone tooltip — the new component keeps the name `Tooltip`. It lives at `src/renderer/uikit/Tooltip/`.

### Audit of existing tooltip implementations

Four legacy implementations exist; none migrate in this task.

| File | Lines | Pattern | Migrates with |
|------|-------|---------|---------------|
| [`components/basic/Tooltip.tsx`](../../../src/renderer/components/basic/Tooltip.tsx) | 45 | Thin wrapper around `react-tooltip` v5 (`<Tooltip id={id}>` + sibling target with `data-tooltip-id={id}`). Portaled. Default `delayShow={600}`, `place="top"`. | All consumers below; `react-tooltip` dep removed only after the last one migrates (separate cleanup task). |
| [`editors/link-editor/LinkTooltip.tsx`](../../../src/renderer/editors/link-editor/LinkTooltip.tsx) | 152 | Wraps `components/basic/Tooltip` to render a custom body — title + href + image + interactive tag chips with `+ tag (Enter)` input. Used by `LinksList`, `PinnedLinksPanel`, `LinkCategoryPanel`. | Migrates with the LinkEditor screens. |
| [`editors/graph/GraphTooltip.tsx`](../../../src/renderer/editors/graph/GraphTooltip.tsx) | 277 | **Custom** floating tooltip (no `react-tooltip`). Imperatively positioned via `position: fixed; top/left` based on cursor location, portaled to `document.body`. Has its own click-outside / hover-out logic and a navigable link section. Used by `GraphView`. | Migrates with the graph editor. May or may not adopt UIKit `Tooltip` — the bespoke positioning logic (cursor-anchored, not element-anchored) might justify keeping a graph-specific implementation. Decision deferred to that migration. |
| [`components/basic/OverflowTooltipText.tsx`](../../../src/renderer/components/basic/OverflowTooltipText.tsx) | 51 | A `<span>` that detects horizontal overflow on hover and sets the native `title` attribute conditionally. Not really a "tooltip primitive" — it's an overflow detector that delegates rendering to the browser's native title bubble. | Migrates with whatever screen first needs `TruncatedText` (per US-438 naming). UIKit `TruncatedText` is a separate task; it may compose UIKit `Tooltip` for richer overflow display, or it may keep the native-`title` shortcut. |

#### Library

`@floating-ui/react`. Already in dependencies (consumed by legacy `Popper` and US-466 Popover); no new package.

`react-tooltip` v5 is the legacy dependency. It is **not removed** in this task — `components/basic/Tooltip.tsx` and the four consumers above continue to use it until each migrates. Removal is a follow-up cleanup task scheduled when the last consumer migrates.

#### Behavior comparison

| Legacy `react-tooltip` behavior | UIKit Tooltip | Reason |
|---|---|---|
| Trigger pairing via `data-tooltip-id={id}` + sibling `<Tooltip id={id}>` (one tooltip can serve many triggers via shared id, configured globally per page). | **Replaced with wrapper + cloneElement.** `<Tooltip content="…">{trigger}</Tooltip>`. Co-locates content with trigger; no UUID-per-trigger boilerplate. | Library code in app currently generates UUIDs per Button instance ([`Button.tsx:158`](../../../src/renderer/components/basic/Button.tsx#L158)) — pure overhead. The wrapper pattern eliminates the UUID + sibling render cost. |
| Hover-triggered with `delayShow` / `delayHide`. | **Keep.** Default `delayShow={600}`, `delayHide={100}`. Per-instance overrides via props. | 600ms is the legacy default; matches user muscle memory. 100ms hide-delay prevents flicker when crossing a 1px gap between trigger and tooltip body. |
| Focus-triggered for keyboard users (built-in). | **Keep.** Tooltip opens on `focus`/`focusin` and closes on `blur`/`focusout`. | Required for accessibility — keyboard users never trigger `mouseenter`. Free with floating-ui's hover/focus interactions, but we implement manually so `Tooltip` doesn't drag in `useInteractions` complexity. |
| Click-outside dismisses. | **Drop.** Tooltips dismiss on `mouseleave` / `blur` only, never on click. | A click on the trigger is a primary action; the tooltip should disappear because the click typically moves focus or covers the area. We rely on `mouseleave` / `blur` from the trigger; a click outside the trigger naturally doesn't keep mouse over it. No special handler needed. |
| Touch — long-press triggers. | **Drop.** Persephone is Electron desktop only. | No touch UX in scope. |
| `place: "top" \| "bottom" \| "left" \| "right"` (4 values) | **Generalized to floating-ui `Placement`** (12 values: `"top" \| "top-start" \| "top-end" \| "bottom" \| "bottom-start" \| "bottom-end" \| "left" \| "left-start" \| "left-end" \| "right" \| "right-start" \| "right-end"`). Default `"top"`. | Same union UIKit `Popover` uses. Keeps the two overlay primitives' position APIs symmetric. |
| Auto-flip when near viewport edge. | **Keep** via floating-ui's `flip()` middleware. | Same as Popover. |
| `clickable` (allows children to receive clicks — clicks on the tooltip body don't dismiss). | **Always-on.** No prop. | The wrapper pattern's dismissal is hover/focus-driven, not click-driven, so the body is implicitly clickable by default. Legacy `LinkTooltip` is a real consumer (its tag chips are clickable). |
| `html` prop (raw HTML string content). | **Drop.** Use `content: ReactNode` instead. | XSS surface; React JSX is strictly better. Legacy is barely used. |
| `style` overrides via global CSS class names. | **Drop.** UIKit Tooltip styles are fixed; consumers compose content with UIKit primitives. | Rule 7. |

#### Visual / layout

Legacy `app-tooltip` style ([`Tooltip.tsx:8`](../../../src/renderer/components/basic/Tooltip.tsx#L8)):

```ts
backgroundColor: color.background.default,
color: color.text.dark,
zIndex: 1000,
borderRadius: 4,
border: `1px solid ${color.border.default}`,
fontSize: 14,
whiteSpace: "pre",
padding: 0,           // outer
"& .tooltip-content": {
    padding: 8,        // inner
}
```

UIKit Tooltip root:
- `background: color.background.default` ✓
- `color: color.text.default` (legacy uses `color.text.dark` — that's a render-on-light-bg color and may look wrong on dark themes; switching to `text.default` is the consistent choice and matches Popover/Panel)
- `border: 1px solid color.border.default` ✓
- `borderRadius: radius.md` (= 4) ✓
- `fontSize: fontSize.sm` (= 12 — tooltip is secondary information; one step smaller than body text, matches GraphTooltip's `fontSize: 12` choice)
- `padding: spacing.md` (= 8 — single padding, no inner wrapper)
- `boxShadow: 0 2px 8px ${color.shadow.default}` (matches Popover; legacy `react-tooltip` skin had no shadow but the bespoke `GraphTooltip` does — shadow improves legibility on patterned backgrounds)
- `WebkitAppRegion: "no-drag"` ✓ (frameless Electron window — same defensive copy as Popover)
- `pointerEvents: "auto"` ✓ (so clickable body content works)
- `userSelect: "text"` ✓ (so users can copy text out of a tooltip — matches GraphTooltip)
- `maxWidth: 360` (legacy `LinkTooltip` uses `maxWidth: 360`, GraphTooltip uses `400` — 360 is the lower bound that fits all current rich-content cases without excessive line-wrap)

No `whiteSpace: "pre"`. Legacy enforces preformatted line breaks because it was used with raw strings; UIKit Tooltip's `content: ReactNode` lets the consumer choose `<Text whiteSpace="pre">` if they need preformatted content.

#### Portaling

UIKit Tooltip portals by default to `document.body` via `ReactDOM.createPortal`. Same rationale as Popover: `position: fixed` strategy + portal eliminates clipping by ancestor stacking contexts. No prop needed.

### Files involved

| File | Role | Change |
|------|------|--------|
| `src/renderer/uikit/Tooltip/Tooltip.tsx` | UIKit Tooltip component | **New** |
| `src/renderer/uikit/Tooltip/Tooltip.story.tsx` | Storybook story | **New** |
| `src/renderer/uikit/Tooltip/index.ts` | Folder barrel export | **New** |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit public exports | Add `Tooltip` + `TooltipProps` under `// Overlay` |
| [src/renderer/uikit/Button/Button.tsx](../../../src/renderer/uikit/Button/Button.tsx) | UIKit Button | Add `title?: React.ReactNode` (overrides HTML `title: string`); wrap in `<Tooltip>` when set |
| [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) | UIKit IconButton | Add `title?: React.ReactNode` (overrides HTML `title: string`); wrap in `<Tooltip>` when set |
| [src/renderer/uikit/Button/Button.story.tsx](../../../src/renderer/uikit/Button/Button.story.tsx) | Button story | Add a `title` prop control to demo the integrated tooltip |
| [src/renderer/uikit/IconButton/IconButton.story.tsx](../../../src/renderer/uikit/IconButton/IconButton.story.tsx) | IconButton story | Add a `title` prop control to demo the integrated tooltip |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Story registry | Register `tooltipStory` under the existing `// Overlay` section |
| [doc/active-work.md](../../active-work.md) | Dashboard | Convert US-467 line to a markdown link to this README |

### Files NOT changed

- `src/renderer/components/basic/Tooltip.tsx` — legacy stays in place. Removed only after all four legacy consumers migrate.
- `src/renderer/components/basic/OverflowTooltipText.tsx` — separate concern (overflow detection); migrates as part of UIKit `TruncatedText`, a future task.
- `src/renderer/components/basic/Button.tsx` (legacy `Button` with `tooltip` / `title` shortcut props) — not touched. The legacy Button keeps its `react-tooltip`-based mechanism until each consumer screen migrates to UIKit Button.
- All four legacy tooltip-using files (`LinkTooltip.tsx`, `GraphTooltip.tsx`, `OverflowTooltipText.tsx`, every consumer of `components/basic/Tooltip`) — none touched here.
- `package.json` — `react-tooltip` stays in dependencies until the last consumer migrates.

## Implementation plan

### Step 1 — Create `Tooltip.tsx`

Path: `src/renderer/uikit/Tooltip/Tooltip.tsx`. Single-file component, ~150 lines.

Public API:

```tsx
import { Placement } from "@floating-ui/react";

export interface TooltipProps {
    /**
     * The tooltip body. Plain strings render as plain text; ReactNode lets the consumer
     * compose richer content (e.g. multi-line layouts, images, clickable elements). When
     * `content` is `null`, `undefined`, or `false`, the tooltip is suppressed and the
     * trigger renders without any wrapping behavior — letting consumers conditionally
     * disable a tooltip without unmounting the trigger.
     */
    content: React.ReactNode;
    /**
     * The trigger element. MUST be a single React element whose ref forwards to the
     * underlying DOM node. UIKit components (Button, IconButton, …) and standard HTML
     * elements all qualify.
     */
    children: React.ReactElement;
    /** Floating-ui placement. Default: "top". */
    placement?: Placement;
    /** [skidding, distance] — skidding shifts perpendicular to the main axis. Default: [0, 8]. */
    offset?: [number, number];
    /** Milliseconds to wait after pointer enter before opening. Default: 600. */
    delayShow?: number;
    /** Milliseconds to wait after pointer leave before closing. Default: 100. */
    delayHide?: number;
    /**
     * When true, the tooltip is fully suppressed regardless of `content`. Useful when the
     * tooltip should only appear under specific conditions (e.g. only when a label is
     * truncated — see TruncatedText, future task).
     */
    disabled?: boolean;
}
```

Internal:

```tsx
import React, { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    Placement,
    useFloating,
    offset as floatingOffset,
    flip,
    autoUpdate,
} from "@floating-ui/react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, radius, spacing } from "../tokens";

// --- Styled ---

const Root = styled.div(
    {
        backgroundColor: color.background.default,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: radius.md,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        fontSize: fontSize.sm,
        padding: spacing.md,
        maxWidth: 360,
        pointerEvents: "auto",
        userSelect: "text",
        WebkitAppRegion: "no-drag",
    },
    { label: "Tooltip" },
);

// --- Component ---

export function Tooltip({
    content,
    children,
    placement = "top",
    offset = [0, 8],
    delayShow = 600,
    delayHide = 100,
    disabled,
}: TooltipProps) {
    const [open, setOpen] = useState(false);
    const showTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    const middleware = useMemo(
        () => [floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] }), flip()],
        [offset],
    );

    const { refs, floatingStyles, placement: actualPlacement } = useFloating({
        open,
        onOpenChange: setOpen,
        placement,
        middleware,
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
    });

    const clearTimers = useCallback(() => {
        if (showTimerRef.current !== null) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
        }
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    useEffect(() => clearTimers, [clearTimers]);

    const scheduleShow = useCallback(() => {
        clearTimers();
        showTimerRef.current = window.setTimeout(() => {
            showTimerRef.current = null;
            setOpen(true);
        }, delayShow);
    }, [clearTimers, delayShow]);

    const scheduleHide = useCallback(() => {
        clearTimers();
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setOpen(false);
        }, delayHide);
    }, [clearTimers, delayHide]);

    const suppressed = disabled || content === null || content === undefined || content === false;

    // Merge our handlers with whatever the child already has.
    const childRef = (children as any).ref as React.Ref<unknown> | undefined;
    const mergedRef = useCallback(
        (node: Element | null) => {
            refs.setReference(node);
            if (typeof childRef === "function") childRef(node);
            else if (childRef && typeof childRef === "object")
                (childRef as React.MutableRefObject<Element | null>).current = node;
        },
        [refs, childRef],
    );

    const childProps = children.props as Record<string, any>;
    const trigger = cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e: React.MouseEvent) => {
            childProps.onMouseEnter?.(e);
            if (!suppressed) scheduleShow();
        },
        onMouseLeave: (e: React.MouseEvent) => {
            childProps.onMouseLeave?.(e);
            if (!suppressed) scheduleHide();
        },
        onFocus: (e: React.FocusEvent) => {
            childProps.onFocus?.(e);
            if (!suppressed) scheduleShow();
        },
        onBlur: (e: React.FocusEvent) => {
            childProps.onBlur?.(e);
            if (!suppressed) scheduleHide();
        },
    });

    if (suppressed || !open) return trigger;

    return (
        <>
            {trigger}
            {ReactDOM.createPortal(
                <Root
                    ref={refs.setFloating}
                    data-type="tooltip"
                    data-placement={actualPlacement}
                    role="tooltip"
                    style={{ ...floatingStyles, zIndex: 1100 }}
                    onMouseEnter={clearTimers}
                    onMouseLeave={scheduleHide}
                >
                    {content}
                </Root>,
                document.body,
            )}
        </>
    );
}
```

Notes on the implementation:
- **`zIndex: 1100`** — one level above Popover's 1000 so a tooltip on a Popover-rendered control appears above the popover.
- **`data-type="tooltip"`** per Rule 1.
- **`data-placement={actualPlacement}`** exposes the resolved placement (after auto-flip) for DevTools / agent inspection. Same as Popover.
- **`role="tooltip"`** for screen-reader accessibility — paired with `aria-describedby` on the trigger if a consumer chooses to wire it (out of scope here; consumers can pass `aria-describedby` through trigger props).
- **`onMouseEnter` on the tooltip body cancels the hide timer** — lets users move the cursor onto the tooltip to copy text or click chips without dismissal. `onMouseLeave` on the body re-schedules the hide. Without this, any cursor exit from the trigger immediately starts the hide timer and the user has only `delayHide` ms to enter the tooltip — too short.
- **`useFloating({ open, onOpenChange })`** — `open` is internal state per Rule 2's allowlist for transient UI state.
- **`floatingStyles` is the only inline style** on UIKit's own root — internal styling, allowed since the rule on `style` applies to consumers of UIKit, not UIKit's own implementation.
- **Suppression**: when `disabled` or `content` is empty, the trigger is returned bare (no event handlers attached, no portal mounted). This keeps `<Tooltip content={maybeNull}>` zero-cost when content is falsy.
- **Ref merging**: floating-ui needs a ref on the trigger. The child element may already have a ref (consumer might be measuring it elsewhere). The merged ref forwards the node to both floating-ui's `setReference` and the original ref.
- **No internal `useRef` on the floating element** — `refs.setFloating` is enough; we don't need a separate ref for click-outside (no click-outside dismissal here).
- **`window.setTimeout` typed return** — explicit `number` type; cleared in cleanup effect.

### Step 2 — Create `index.ts`

Path: `src/renderer/uikit/Tooltip/index.ts`:

```ts
export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
```

### Step 3 — Update UIKit barrel

[`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) — add under the `// Overlay` section:

**Before:**
```ts
// Overlay
export { Popover } from "./Popover";
export type { PopoverProps, PopoverPosition } from "./Popover";
```

**After:**
```ts
// Overlay
export { Popover } from "./Popover";
export type { PopoverProps, PopoverPosition } from "./Popover";
export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
```

### Step 4 — Create `Tooltip.story.tsx`

Path: `src/renderer/uikit/Tooltip/Tooltip.story.tsx`. Storybook entry that renders a tooltip-wrapped Button so the user can play with placement, content, and delays.

```tsx
import React from "react";
import { Tooltip } from "./Tooltip";
import { Button } from "../Button/Button";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

const PLACEMENTS = [
    "top", "top-start", "top-end",
    "bottom", "bottom-start", "bottom-end",
    "left", "left-start", "left-end",
    "right", "right-start", "right-end",
];

interface DemoProps {
    placement?: string;
    delayShow?: number;
    delayHide?: number;
    offsetX?: number;
    offsetY?: number;
    richContent?: boolean;
    disabled?: boolean;
}

const TooltipDemo = ({
    placement = "top",
    delayShow = 600,
    delayHide = 100,
    offsetX = 0,
    offsetY = 8,
    richContent = false,
    disabled = false,
}: DemoProps) => {
    const content = richContent ? (
        <Panel direction="column" gap="sm">
            <Text weight="strong">Rich content</Text>
            <Text size="sm" color="light">
                Multi-line tooltip body with secondary text.
            </Text>
            <Text size="sm">
                Hover the tooltip itself — it stays open while the cursor is on it.
            </Text>
        </Panel>
    ) : (
        "Hello from Tooltip"
    );

    return (
        <Panel direction="column" gap="lg" padding="xl" align="start">
            <Text size="sm" color="light">
                Hover the button. Default delays: 600 ms show, 100 ms hide.
            </Text>
            <Tooltip
                content={content}
                placement={placement as any}
                offset={[offsetX, offsetY]}
                delayShow={delayShow}
                delayHide={delayHide}
                disabled={disabled}
            >
                <Button>Hover me</Button>
            </Tooltip>
        </Panel>
    );
};

export const tooltipStory: Story = {
    id: "tooltip",
    name: "Tooltip",
    section: "Overlay",
    component: TooltipDemo as any,
    props: [
        { name: "placement",   type: "enum",    options: PLACEMENTS, default: "top" },
        { name: "delayShow",   type: "number",  default: 600 },
        { name: "delayHide",   type: "number",  default: 100 },
        { name: "offsetX",     type: "number",  default: 0 },
        { name: "offsetY",     type: "number",  default: 8 },
        { name: "richContent", type: "boolean", default: false },
        { name: "disabled",    type: "boolean", default: false },
    ],
};
```

Design notes for the story:
- Uses UIKit `Button` as the trigger (matches Popover story's choice — visual consistency in the catalog).
- The `richContent` toggle exercises the `ReactNode` content path with a `<Panel>` body.
- The `disabled` toggle proves the suppression path (tooltip stops appearing without unmounting the trigger).
- All wrapping JSX is UIKit primitives (Panel, Text, Button) — Rule 7 compliant.

### Step 5 — Register the story

[`src/renderer/editors/storybook/storyRegistry.ts`](../../../src/renderer/editors/storybook/storyRegistry.ts) — add under the existing `// Overlay` section:

**Before:**
```ts
// Overlay
import { popoverStory }          from "../../uikit/Popover/Popover.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory, spinnerStory,
    popoverStory,
];
```

**After:**
```ts
// Overlay
import { popoverStory }          from "../../uikit/Popover/Popover.story";
import { tooltipStory }          from "../../uikit/Tooltip/Tooltip.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory, spinnerStory,
    popoverStory, tooltipStory,
];
```

### Step 6 — Add `title?: ReactNode` to UIKit Button

Path: [src/renderer/uikit/Button/Button.tsx](../../../src/renderer/uikit/Button/Button.tsx).

**Type change** — the inherited `React.ButtonHTMLAttributes<HTMLButtonElement>` includes `title?: string`. We override it with `title?: React.ReactNode` so the prop accepts both plain strings and rich `Panel`-based content. Use `Omit<…, "title">`, the same shape used by the `style` / `className` removals elsewhere in UIKit:

**Before:**
```ts
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. Default: "default". */
    variant?: "default" | "primary" | "ghost" | "danger" | "link";
    // …
}
```

**After:**
```ts
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    /**
     * When set, the button is wrapped in a UIKit `<Tooltip>` displaying this content on
     * hover/focus. Accepts a plain string (most common — clarifies the button's purpose)
     * or rich `ReactNode` (e.g. multi-line layouts, links). When unset, no tooltip is
     * rendered and no event handlers are attached — zero cost.
     */
    title?: React.ReactNode;
    /** Visual style. Default: "default". */
    variant?: "default" | "primary" | "ghost" | "danger" | "link";
    // …
}
```

**Render change** — destructure `title` so it is NOT spread to the DOM (would re-enable the native browser tooltip), then conditionally wrap the rendered button in a `<Tooltip>`:

**Before:**
```tsx
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        { variant = "default", size = "md", background = "default", block, icon, disabled, children, ...rest },
        ref,
    ) {
        return (
            <Root
                ref={ref}
                data-type="button"
                // …
                {...rest}
            >
                {icon}
                {children}
            </Root>
        );
    },
);
```

**After:**
```tsx
import { Tooltip } from "../Tooltip/Tooltip";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        { variant = "default", size = "md", background = "default", block, icon, disabled, title, children, ...rest },
        ref,
    ) {
        const button = (
            <Root
                ref={ref}
                data-type="button"
                // …
                {...rest}
            >
                {icon}
                {children}
            </Root>
        );
        return title ? <Tooltip content={title}>{button}</Tooltip> : button;
    },
);
```

Notes:
- Direct import from `../Tooltip/Tooltip` (not the barrel) — UIKit folder convention is direct imports between sibling components to avoid circular dependency risk through the barrel.
- The `title` prop is destructured **before** `...rest`, so it never reaches the DOM. The `<Root>` element therefore has no `title` HTML attribute and the native browser tooltip never appears.
- When `title` is `undefined` / `null` / `false` / `""`, the truthiness check skips the `<Tooltip>` wrapper entirely — zero rendering cost, no extra event handlers on the button.

### Step 7 — Add `title?: ReactNode` to UIKit IconButton

Path: [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx). Same pattern as Button.

**Type change:**

**Before:**
```ts
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: React.ReactNode;
    size?: "sm" | "md";
}
```

**After:**
```ts
export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    /**
     * When set, the IconButton is wrapped in a UIKit `<Tooltip>` displaying this content
     * on hover/focus. Especially valuable for IconButtons since they have no visible label
     * to clarify their purpose. When unset, no tooltip is rendered.
     */
    title?: React.ReactNode;
    icon: React.ReactNode;
    size?: "sm" | "md";
}
```

**Render change:**

**Before:**
```tsx
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({ icon, size = "md", disabled, ...rest }, ref) {
        return (
            <Root ref={ref} data-type="icon-button" /* … */ {...rest}>
                <span data-part="icon">{icon}</span>
            </Root>
        );
    },
);
```

**After:**
```tsx
import { Tooltip } from "../Tooltip/Tooltip";

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({ icon, size = "md", disabled, title, ...rest }, ref) {
        const button = (
            <Root ref={ref} data-type="icon-button" /* … */ {...rest}>
                <span data-part="icon">{icon}</span>
            </Root>
        );
        return title ? <Tooltip content={title}>{button}</Tooltip> : button;
    },
);
```

### Step 8 — Update Button and IconButton stories

Add a `title` prop control to both stories so a Storybook user can toggle the tooltip on. The exact existing story shape lives in [Button.story.tsx](../../../src/renderer/uikit/Button/Button.story.tsx) and [IconButton.story.tsx](../../../src/renderer/uikit/IconButton/IconButton.story.tsx) — preserve their existing controls, add one entry:

```ts
{ name: "title", type: "string", default: "" },
```

In the demo render, pass `title={title || undefined}` so an empty string suppresses the tooltip (matches the production-code convention where omitted is no-tooltip).

### Step 9 — TypeScript check

`npx tsc --noEmit` — no new errors on `Tooltip.tsx`, `Tooltip.story.tsx`, `uikit/index.ts`, `storyRegistry.ts`, `Button.tsx`, `IconButton.tsx`, `Button.story.tsx`, `IconButton.story.tsx`.

Verify in particular that the `Omit<…, "title">` propagates: passing `title="foo"` to a UIKit `Button` should resolve to `string` (the `ReactNode` superset) without TypeScript complaining about the override being incompatible with the base.

### Step 10 — Manual smoke test (Storybook)

Run the app, open the Storybook editor.

**Tooltip story** ("Overlay" → "Tooltip"):
- Hover the button and wait — tooltip appears after 600 ms.
- Move cursor off — tooltip disappears after 100 ms.
- Move cursor from the button onto the tooltip body — tooltip stays open.
- Cycle placements — position updates; auto-flip kicks in near viewport edges.
- Set `delayShow=0` — tooltip appears immediately.
- Set `richContent=true` — tooltip body renders the multi-line `<Panel>` layout.
- Set `disabled=true` — hovering the button does not open the tooltip; trigger still works as a normal Button.
- Tab to the button (focus) — tooltip appears after the show delay. Shift+Tab away — tooltip closes.
- DevTools — tooltip root has `data-type="tooltip"`, `data-placement="<resolved>"`, `role="tooltip"`; tooltip is a child of `<body>` (portaled).
- Cycle themes (`default-dark`, `light-modern`, `monokai`) — tooltip background, border, shadow, and text color all update.

**Button story** ("Bootstrap" → "Button"):
- Set the `title` prop to e.g. `"Save the file"`. Hover the button — UIKit tooltip appears (not the native browser tooltip).
- Inspect the rendered `<button data-type="button">` in DevTools — there is **no** `title` HTML attribute on it (the native tooltip would otherwise also appear).
- Clear the `title` prop. Hover the button — no tooltip. The button has no event listeners related to tooltip behavior (verified by inspecting React DevTools or by setting a breakpoint on the Tooltip's `scheduleShow`).

**IconButton story** ("Bootstrap" → "IconButton"):
- Set the `title` prop to e.g. `"Run script"`. Hover the icon button — UIKit tooltip appears with that content.
- Same DOM check — no native `title` attribute on the rendered `<button>`.

### Step 11 — Update dashboard

Already handled at task creation — entry on the dashboard is a markdown link to this README.

## Concerns / Open questions

All resolved before implementation.

### 1. Wrapper-with-cloneElement vs imperative anchor-ref pattern — RESOLVED: wrapper-only

The legacy `react-tooltip` uses a paired-id pattern (`<Trigger data-tooltip-id="x" />` + `<Tooltip id="x">…</Tooltip>` rendered separately). UIKit Popover uses an imperative pattern (`<Popover elementRef={anchorRef.current}>…`).

Two viable patterns for Tooltip:

- **Wrapper**: `<Tooltip content={node}><Button>…</Button></Tooltip>` — clones single child, attaches handlers, merges refs.
- **Imperative**: `<Tooltip content={node} anchorRef={ref}/>` — anchor passed explicitly, handlers wired up by consumer.

**Decision**: wrapper-only.

Reasoning:
- A tooltip is *always* attached to a single trigger. Unlike a popover (which can be cursor-anchored, programmatically opened, or shared between triggers), a tooltip is conceptually paired 1:1 with a hoverable element.
- The wrapper avoids per-instance UUIDs and the trigger-content separation that plagues legacy `Tooltip`'s consumers (e.g. `Button.tsx:158-211` allocates a UUID and renders a sibling `<Tooltip id={id}>` for every button).
- The wrapper is the universal convention (Radix `Tooltip.Root` + `Tooltip.Trigger`, MUI `Tooltip`, Mantine `Tooltip` — all wrapper-based).
- Future descriptor-based UIs (EPIC-025 Phase 6) can express this as `{ component: "Button", label: "Save", tooltip: "Save the file" }` — UIKit `Button` would internally wrap itself when a `tooltip` prop is set. This decision belongs in a follow-up task once UIKit Tooltip exists; see Concern #5.

The imperative pattern stays available indirectly via Popover (`<Popover>` is what you reach for when you need a programmatic floating overlay). Tooltip and Popover are not interchangeable: Tooltip is hover-driven and informational; Popover is open-state-driven and interactive.

### 2. Should the trigger child be required to forward refs? — RESOLVED: yes, document it

`cloneElement` + `ref` only works if the child element forwards its ref to a DOM node. All UIKit components do (`Button`, `IconButton`, `Input`, etc. — verified). Standard HTML elements (`<button>`, `<a>`, `<span>`) do. Legacy `Button` ([`components/basic/Button.tsx:142`](../../../src/renderer/components/basic/Button.tsx#L142)) also uses `forwardRef`.

If a consumer wraps a non-forwardRef component and the ref doesn't reach a DOM node, `useFloating` won't have a reference element and the tooltip won't position. Documented in the JSDoc on `children`. No runtime warning needed — TypeScript catches the mismatch when a non-forwardRef component lacks a `ref` prop in its type. In practice, every UIKit component is forwardRef'd by convention.

### 3. Default placement — `"top"`? — RESOLVED: yes

Legacy `Tooltip` defaults to `"top"`. Native HTML `title` attribute renders below or above depending on viewport. `"top"` is the universal default across libraries (Radix, MUI, Mantine). Auto-flip kicks in when there's no room above.

### 4. Should the tooltip be dismissable on Escape? — RESOLVED: yes, but only when focus-triggered

When the tooltip is open because of *focus* (keyboard user has tabbed to the trigger), Escape should close it without removing focus. When it's open because of *hover*, Escape is irrelevant — the user is using the mouse and can simply move it.

**However**: distinguishing "open because of hover" vs "open because of focus" complicates state. A simpler approach: always close on Escape if the trigger is focused. Implementation:

```tsx
onKeyDown: (e: React.KeyboardEvent) => {
    childProps.onKeyDown?.(e);
    if (e.key === "Escape" && open) setOpen(false);
}
```

Add to the cloneElement step. Keep this in the implementation. Listed in Step 1's code as a follow-on; the author should add `onKeyDown` to the merged handlers. The acceptance criteria explicitly check this.

### 5. Should UIKit Button / IconButton get a tooltip prop? — RESOLVED: yes, `title?: ReactNode`, integrated in this task

The legacy `components/basic/Button.tsx` accepts `tooltip` / `title` props and renders the tooltip internally — convenient, but the implementation has costs (UUID-per-instance, sibling `<Tooltip id={id}>` on every render even when unused).

For UIKit, the integrated tooltip is the right call because:

1. **Buttons in Persephone almost always benefit from a tooltip** clarifying their purpose — especially `IconButton`, which has no visible label at all. Forcing every consumer to write `<Tooltip content="Save"><IconButton …/></Tooltip>` is verbose for the common case.
2. **The native `title=""` HTML attribute looks inconsistent with the app's design** — small system tooltip with non-overridable styling, awkward delay, no theme integration. Using a custom UIKit Tooltip ensures uniformity across the app.
3. **The integration is essentially free** — when `title` is unset, no `<Tooltip>` is rendered and no event handlers attach (just one truthiness check on each render). The cost only appears on consumers that opt in by setting `title`.
4. **Reusing the prop name `title`** keeps the API close to HTML conventions (developers already think "I want a tooltip on this button — I'll set `title`"). The `Omit<…, "title">` override widens the type from `string` to `ReactNode` so rich content also works.

API: `title?: React.ReactNode` on both UIKit `Button` and `IconButton`. When set: wraps the rendered element in `<Tooltip content={title}>`. When unset: no Tooltip wrapper, zero cost. The HTML `title` attribute is not spread to the DOM (we destructure it out before `...rest`), so the native tooltip never appears.

The standalone `<Tooltip>` component remains the API for tooltip-on-non-button-elements (e.g. tooltip on a row in a list, on a label, on a custom interactive element).

### 6. Hover-onto-tooltip-body to keep it open — necessary? — RESOLVED: yes

Legacy `react-tooltip` supports `clickable` for this. The bespoke `LinkTooltip` body has clickable tag chips; without "hover the body keeps it open", users couldn't reach the chips. Keep the body's `onMouseEnter` / `onMouseLeave` handlers in UIKit Tooltip — exactly the pattern shown in Step 1's code.

### 7. Two-tooltip case: tooltip on a control inside a Popover — RESOLVED: stack via z-index

Tooltip's `zIndex: 1100` sits one level above Popover's `1000`. A Tooltip on a Button inside a Popover renders above the Popover correctly. (Tested in the smoke-test acceptance criteria.)

### 8. Does the wrapper component handle `React.Fragment` children? — RESOLVED: no, throw at runtime in dev only? — RESOLVED: no runtime check, document the constraint

`React.Children.only(children)` could enforce single-child at runtime. But:
- TypeScript already enforces `children: React.ReactElement` (singular). Passing a Fragment with multiple children produces a type error.
- Adding `React.Children.only` adds a runtime check that's purely redundant for typed consumers.

Skip the runtime check. The JSDoc on `children` documents the expectation: "single React element whose ref forwards to the underlying DOM node."

### 9. Should the trigger get `aria-describedby` linking to the tooltip's id? — RESOLVED: not in MVP

Proper a11y wiring requires the tooltip to have an `id` and the trigger to have `aria-describedby={tooltipId}` while the tooltip is open. This is a worthwhile improvement but adds:
- Per-instance unique id generation (back to the UUID pattern, ironically).
- A second `cloneElement` pass to set `aria-describedby` on the child.
- Coordination with consumers that already set `aria-describedby` (need to merge, not overwrite).

For MVP, the tooltip has `role="tooltip"` (so a screen reader can find it once focus is in scope) but no `aria-describedby` link. Acceptable for an internal Electron-only desktop app. Revisit if accessibility audits surface specific needs.

### 10. Existing legacy consumers — migrate any in this task? — RESOLVED: no

Same per-screen migration philosophy as US-466 Popover. Each of the four legacy tooltip implementations migrates with its parent screen:
- `LinkTooltip.tsx` — migrates with LinkEditor screens (LinksList, PinnedLinksPanel, LinkCategoryPanel) when those reach Phase 4.
- `GraphTooltip.tsx` — migrates with the graph editor; may or may not adopt UIKit Tooltip given its bespoke cursor-anchored positioning.
- `OverflowTooltipText.tsx` — migrates as part of UIKit `TruncatedText` (separate task per US-438).
- The remaining `components/basic/Tooltip.tsx` consumers (`PageTab`, `FolderItem`, `MenuBar`, `OpenTabsList`, `FileList`, `AlertItem`, `DataCell`, `List`) — each migrates with its parent screen.

### 11. Removal of `react-tooltip` dependency — RESOLVED: separate cleanup task

`react-tooltip` v5 is removed from `package.json` only after the last consumer migrates. Tracked as an implicit follow-up; not scheduled now since the migration order of legacy consumers determines when the last one lands.

## Acceptance criteria

1. `src/renderer/uikit/Tooltip/Tooltip.tsx` exists and exports `Tooltip` (function component) + `TooltipProps`.
2. `src/renderer/uikit/index.ts` re-exports `Tooltip` and `TooltipProps` under the `// Overlay` section.
3. `src/renderer/uikit/Tooltip/Tooltip.story.tsx` registers `tooltipStory` in [storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) and renders an interactive tooltip-wrapped Button with placement / delay / content / disabled controls.
4. The Tooltip root sets `data-type="tooltip"`, `data-placement="<resolved>"`, and `role="tooltip"`.
5. The Tooltip portals into `document.body` via `ReactDOM.createPortal`. The trigger element renders in place.
6. `npx tsc --noEmit` reports no new errors on `Tooltip.tsx`, `Tooltip.story.tsx`, `uikit/index.ts`, `storyRegistry.ts`.
7. **Smoke test — show / hide on hover**: Hover the trigger Button and wait `delayShow` ms — tooltip appears. Move cursor off — tooltip disappears `delayHide` ms later.
8. **Smoke test — show / hide on focus**: Tab to the trigger — tooltip appears after `delayShow`. Shift+Tab away — tooltip disappears after `delayHide`.
9. **Smoke test — escape dismissal**: With focus on the trigger and tooltip open, press Escape — tooltip closes immediately; trigger remains focused.
10. **Smoke test — hover-the-body keeps open**: Move cursor from the trigger onto the tooltip body before `delayHide` elapses — tooltip stays open. Move cursor off the body — tooltip closes after `delayHide`.
11. **Smoke test — placements**: Cycle through `"top"`, `"bottom"`, `"left"`, `"right"`, `"top-start"`, `"bottom-end"` etc. Tooltip positions correctly with the configured offset.
12. **Smoke test — auto-flip**: Position the trigger near the top of the viewport and set placement to `"top"`. Tooltip auto-flips to `"bottom"` and `data-placement` updates accordingly.
13. **Smoke test — rich content**: With `richContent=true`, the tooltip renders the multi-line `<Panel>` content correctly. Text inside is selectable; clickable elements receive clicks.
14. **Smoke test — `disabled`**: With `disabled=true`, hovering the trigger does NOT open the tooltip. The trigger Button still works (clicks fire normally).
15. **Smoke test — empty content**: Set `content={null}` (and `disabled=false`). Hovering the trigger does NOT open a tooltip; the trigger renders without any wrapping side-effects.
16. **Smoke test — themes**: Cycle `default-dark`, `light-modern`, `monokai`. Tooltip background, border, shadow, and text color update with theme.
17. **Smoke test — z-index over Popover**: Open the Popover story in one tab and the Tooltip story in another to verify visually that a tooltip's z-index (1100) sits above a popover's z-index (1000). (Cross-story stacking is not directly tested, but DevTools inspection on `data-type="tooltip"` confirms `z-index: 1100`.)
18. **UIKit Button — `title` prop**: Setting `<Button title="Save">…</Button>` renders a UIKit Tooltip on hover/focus. The rendered `<button data-type="button">` has **no** native `title` HTML attribute (verified in DevTools).
19. **UIKit Button — no `title` = no tooltip**: A `<Button>` without a `title` prop renders no Tooltip wrapper and attaches no tooltip-related event handlers.
20. **UIKit Button — TypeScript**: `title="string"` and `title={<ReactNode/>}` both type-check; no compatibility error from the `Omit<…, "title">` override.
21. **UIKit IconButton — `title` prop**: Same as #18 / #19 / #20 for `<IconButton>`. Hovering an IconButton with a `title` shows a UIKit Tooltip; without `title`, no tooltip and no native browser tooltip either.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/Tooltip/Tooltip.tsx` | Create | UIKit Tooltip component, ~150 lines |
| `src/renderer/uikit/Tooltip/Tooltip.story.tsx` | Create | Storybook story with placement / delay / rich-content / disabled props |
| `src/renderer/uikit/Tooltip/index.ts` | Create | Folder barrel export |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Modify | Re-export `Tooltip` and `TooltipProps` under `// Overlay` |
| [src/renderer/uikit/Button/Button.tsx](../../../src/renderer/uikit/Button/Button.tsx) | Modify | Add `title?: React.ReactNode` (overrides HTML `title: string`); wrap in `<Tooltip>` when set |
| [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) | Modify | Add `title?: React.ReactNode` (overrides HTML `title: string`); wrap in `<Tooltip>` when set |
| [src/renderer/uikit/Button/Button.story.tsx](../../../src/renderer/uikit/Button/Button.story.tsx) | Modify | Add a `title` prop control |
| [src/renderer/uikit/IconButton/IconButton.story.tsx](../../../src/renderer/uikit/IconButton/IconButton.story.tsx) | Modify | Add a `title` prop control |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Modify | Register `tooltipStory` under `// Overlay` |
| [doc/active-work.md](../../active-work.md) | Modify | Convert US-467 entry to a markdown link to this README |
