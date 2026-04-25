# US-450: UIKit Toolbar — semantic landmark, roving tabindex, Storybook adoption

## Status

**Status:** Planned
**Epic:** [EPIC-025](../../epics/EPIC-025.md) — Phase 3 polish (precedes Phase 4)
**Created:** 2026-04-25

## Goal

Add a `Toolbar` component to UIKit (`src/renderer/uikit/Toolbar/`) that supersedes the legacy [EditorToolbar / PageToolbar](../../../src/renderer/editors/base/EditorToolbar.tsx) for new Storybook code. The component is built around UIKit's adopted patterns: `data-type` identity, `data-*` state, roving tabindex (Design Decision #7), `role="toolbar"` ARIA landmark, design-token sizing, and adaptive `background` prop.

**Scope guard.** The new component replaces `PageToolbar` **only inside the Storybook editor**. Existing app-wide usage of `PageToolbar` ([video](../../../src/renderer/editors/video/VideoPlayerEditor.tsx), [browser](../../../src/renderer/editors/browser/BrowserEditorView.tsx), [archive](../../../src/renderer/editors/archive/ArchiveEditorView.tsx), [text](../../../src/renderer/editors/text/TextEditorView.tsx), [pdf](../../../src/renderer/editors/pdf/PdfViewer.tsx), [mcp-inspector](../../../src/renderer/editors/mcp-inspector/McpInspectorView.tsx), [image](../../../src/renderer/editors/image/ImageViewer.tsx), [compare](../../../src/renderer/editors/compare/CompareEditor.tsx), [category](../../../src/renderer/editors/category/CategoryEditor.tsx), [text/ScriptPanel](../../../src/renderer/editors/text/ScriptPanel.tsx)) is untouched and migrated under separate later tasks.

## Background

### Today's PageToolbar

[src/renderer/editors/base/EditorToolbar.tsx](../../../src/renderer/editors/base/EditorToolbar.tsx) is a single styled `div`. Its only props are `borderTop` / `borderBottom`. `PageToolbar` is an alias re-export. CSS:

```ts
const EditorToolbarRoot = styled.div({
    display: "flex",
    alignItems: "center",
    columnGap: 4,
    flexWrap: "nowrap",
    overflow: "hidden",
    backgroundColor: color.background.dark,
    padding: "2px 4px",
    flexShrink: 0,
    "&.borderTop":    { borderTop:    `1px solid ${color.border.light}` },
    "&.borderBottom": { borderBottom: `1px solid ${color.border.light}` },
    "&:empty":        { display: "none" },
});
```

What it lacks — and what UIKit demands per `src/renderer/uikit/CLAUDE.md` and EPIC-025 Design Decisions:
- No `data-type` (Rule 1 / Decision #6)
- No `role="toolbar"` ARIA landmark
- No roving tabindex (Rule 4 / Decision #7) — Tab visits every button
- No `background` prop — uses `color.background.dark` unconditionally
- No design-token usage (`columnGap: 4` should be `gap.sm`, `padding: "2px 4px"` should be `${spacing.xs}px ${spacing.sm}px`)
- `clsx` className + `&.borderTop` (Rule 1 forbids classNames for state — should be `data-border-top`)
- Class-based wrapper, not the `data-*` convention used elsewhere in UIKit

### Patterns the new component must embody

From [src/renderer/uikit/CLAUDE.md](../../../src/renderer/uikit/CLAUDE.md) and [EPIC-025 design decisions](../../epics/EPIC-025.md):

1. **Rule 1 — `data-type` identity + `data-*` state.** Root has `data-type="toolbar"` plus `data-orientation`, `data-bg`, `data-border-top`/`data-border-bottom`, `data-disabled`. Style via Emotion attribute selectors; never via classNames.
2. **Rule 4 — Roving tabindex.** Single Tab stop at the toolbar level; Arrow keys move focus among navigable children; Home/End jump to ends. Per Decision #7, **toolbars wrap** at the ends (Tree/List clamp). Disabled items are skipped.
3. **Adaptive `background` prop.** `"default" | "light" | "dark"`. Sets the toolbar's own `background-color` and is forwarded to inner `Button`/`IconButton` children via the Storybook auto-injection mechanism — exactly like [Button](../../../src/renderer/uikit/Button/Button.tsx) and [SegmentedControl](../../../src/renderer/uikit/SegmentedControl/SegmentedControl.tsx) handle it.
4. **`role="toolbar"` + `aria-orientation`.** ARIA landmark with optional `aria-label` forwarded from prop.
5. **Design tokens only.** `gap.sm`, `spacing.xs`, `spacing.sm`, `color.background.*`, `color.border.light` — no hard-coded pixels or hex.
6. **ComponentSet-compatible.** Toolbar takes `children` only. Per Decision #5, dynamic descriptor lists are rendered via `<ComponentSet descriptors={items} />` (a Fragment) inserted as a child — no special prop on Toolbar. ComponentSet itself is out of scope here; it lands later. The Toolbar API works the day ComponentSet ships, with no API change.

### Existing roving-tabindex reference

[src/renderer/uikit/SegmentedControl/SegmentedControl.tsx](../../../src/renderer/uikit/SegmentedControl/SegmentedControl.tsx) lines 78–183 implement roving tabindex over a known item array (`segments`). The Toolbar implementation is structurally similar, but operates over **arbitrary DOM children** (the toolbar doesn't know what's inside it), so the algorithm walks `rootRef.current.children` and locates focusable descendants per child.

### Storybook auto-injection of `background`

[src/renderer/editors/storybook/storyTypes.ts](../../../src/renderer/editors/storybook/storyTypes.ts) line 8:
```ts
export const STORYBOOK_MANAGED_PROPS = new Set(["background"]);
```
[LivePreview.tsx](../../../src/renderer/editors/storybook/LivePreview.tsx) lines 41–47 auto-inject `background={previewBackground}` whenever the story declares a `background` prop. So the Toolbar's `background` prop is automatically driven by the toolbar background switcher when viewing the Toolbar story — no extra wiring needed.

## Implementation plan

### Step 1 — Create `src/renderer/uikit/Toolbar/Toolbar.tsx`

Full file content. Algorithm notes inline.

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, spacing } from "../tokens";

// --- Types ---

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Layout direction. Default: "horizontal". */
    orientation?: "horizontal" | "vertical";
    /**
     * Surface background — adjusts the toolbar's own bg and is forwarded to
     * inner Button/IconButton via Storybook's managed-prop auto-injection.
     * Default: "dark" (matches legacy PageToolbar).
     */
    background?: "default" | "light" | "dark";
    /** Render a 1px top border using color.border.light. */
    borderTop?: boolean;
    /** Render a 1px bottom border using color.border.light. */
    borderBottom?: boolean;
    /** Disable the entire toolbar (visual + roving tabindex inert). */
    disabled?: boolean;
    /** Forwarded as the ARIA label of the role="toolbar" landmark. */
    "aria-label"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "inline-flex",
        alignItems: "center",
        columnGap: gap.sm,
        flexWrap: "nowrap",
        overflow: "hidden",
        flexShrink: 0,
        padding: `${spacing.xs}px ${spacing.sm}px`,

        // Empty toolbars collapse — preserves the historical PageToolbar behavior.
        "&:empty": { display: "none" },

        // Default surface — overridden by data-bg below.
        backgroundColor: color.background.dark,
        '&[data-bg="default"]': { backgroundColor: color.background.default },
        '&[data-bg="light"]':   { backgroundColor: color.background.light },
        '&[data-bg="dark"]':    { backgroundColor: color.background.dark },

        '&[data-orientation="vertical"]': {
            flexDirection: "column",
            alignItems: "stretch",
            columnGap: 0,
            rowGap: gap.sm,
            padding: `${spacing.sm}px ${spacing.xs}px`,
        },

        "&[data-border-top]":    { borderTop:    `1px solid ${color.border.light}` },
        "&[data-border-bottom]": { borderBottom: `1px solid ${color.border.light}` },

        "&[data-disabled]": {
            opacity: 0.6,
            pointerEvents: "none",
        },
    },
    { label: "Toolbar" },
);

// --- Roving tabindex helper (Rule 4) ---

/**
 * Returns the first focusable element inside `el`, or `el` itself if it is
 * focusable. Skips elements that are disabled or have `tabindex="-1"`
 * already. A "focusable" element is a button/input/select/textarea or any
 * element with an explicit `tabindex` >= 0.
 */
function findFocusable(el: Element): HTMLElement | null {
    const candidates = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]',
    );
    // Include `el` itself if it is focusable.
    const all = el.matches('button,input,select,textarea,a[href],[tabindex]')
        ? [el as HTMLElement, ...Array.from(candidates)]
        : Array.from(candidates);
    for (const c of all) {
        if (c.hasAttribute("disabled")) continue;
        const ti = c.getAttribute("tabindex");
        if (ti === "-1" && !c.hasAttribute("data-roving-host")) continue;
        return c;
    }
    return null;
}

/**
 * Roving-tabindex hook. Treats each direct DOM child of `rootRef.current` as
 * one "tab stop". For each child, the first focusable descendant gets
 * tabIndex=0 (active) or tabIndex=-1 (inactive). Arrow keys move focus among
 * stops, wrapping at ends. Home/End jump to first/last. Disabled stops are
 * skipped.
 *
 * Nested roving widgets (e.g. SegmentedControl) mark themselves with
 * `data-roving-host` so this hook treats their wrapper as the stop and lets
 * the inner widget own arrow-key handling once focus is inside.
 */
function useRovingTabIndex(
    rootRef: React.RefObject<HTMLDivElement>,
    orientation: "horizontal" | "vertical",
    disabled: boolean | undefined,
) {
    const [activeIdx, setActiveIdx] = React.useState(0);

    // Collect tab stops on every render. Cheap — toolbars are short.
    const collectStops = React.useCallback((): HTMLElement[] => {
        const root = rootRef.current;
        if (!root) return [];
        const stops: HTMLElement[] = [];
        for (const child of Array.from(root.children)) {
            // If the child is itself a roving host (e.g. SegmentedControl),
            // its inner roving manages tabindex on its segments. We use the
            // wrapper's currently-active segment as the stop.
            if (child.hasAttribute("data-roving-host")) {
                const inner = child.querySelector<HTMLElement>('[tabindex="0"]')
                    ?? findFocusable(child);
                if (inner) stops.push(inner);
                continue;
            }
            const f = findFocusable(child);
            if (f) stops.push(f);
        }
        return stops;
    }, [rootRef]);

    // Apply tabIndex on every render. Use a layout effect so it lands before
    // the user can Tab in.
    React.useLayoutEffect(() => {
        if (disabled) {
            for (const s of collectStops()) s.tabIndex = -1;
            return;
        }
        const stops = collectStops();
        if (stops.length === 0) return;
        const idx = Math.min(activeIdx, stops.length - 1);
        stops.forEach((s, i) => { s.tabIndex = i === idx ? 0 : -1; });
    });

    const move = (dir: 1 | -1) => {
        const stops = collectStops();
        const n = stops.length;
        if (n === 0) return;
        let next = activeIdx;
        for (let step = 0; step < n; step++) {
            next = (next + dir + n) % n;
            if (!stops[next].hasAttribute("disabled")) {
                stops[next].focus();
                setActiveIdx(next);
                return;
            }
        }
    };

    const jump = (target: "first" | "last") => {
        const stops = collectStops();
        const n = stops.length;
        if (n === 0) return;
        const range = target === "first"
            ? Array.from({ length: n }, (_, i) => i)
            : Array.from({ length: n }, (_, i) => n - 1 - i);
        for (const i of range) {
            if (!stops[i].hasAttribute("disabled")) {
                stops[i].focus();
                setActiveIdx(i);
                return;
            }
        }
    };

    const handleKey = (e: React.KeyboardEvent) => {
        // Ignore keys that originated inside a nested roving host — that
        // widget already handled them.
        const target = e.target as HTMLElement;
        const root = rootRef.current;
        if (!root) return;
        const host = target.closest("[data-roving-host]");
        if (host && host !== root && root.contains(host)) return;

        const fwd = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
        const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
        switch (e.key) {
            case fwd:  e.preventDefault(); move(1);  break;
            case back: e.preventDefault(); move(-1); break;
            case "Home": e.preventDefault(); jump("first"); break;
            case "End":  e.preventDefault(); jump("last");  break;
        }
    };

    // When focus enters a stop directly (mouse click), keep activeIdx synced.
    const handleFocusCapture = (e: React.FocusEvent) => {
        const stops = collectStops();
        const idx = stops.findIndex((s) => s === e.target || s.contains(e.target as Node));
        if (idx >= 0) setActiveIdx(idx);
    };

    return { handleKey, handleFocusCapture };
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

    return (
        <div
            ref={rootRef}
            role="toolbar"
            aria-orientation={orientation}
            aria-disabled={disabled || undefined}
            data-type="toolbar"
            data-roving-host=""
            data-orientation={orientation}
            data-bg={background}
            data-border-top={borderTop || undefined}
            data-border-bottom={borderBottom || undefined}
            data-disabled={disabled || undefined}
            onKeyDown={(e) => { handleKey(e); onKeyDown?.(e); }}
            onFocusCapture={(e) => { handleFocusCapture(e); onFocusCapture?.(e); }}
            {...rest}
        >
            {children}
        </div>
    );
}
```

**Note about the styled `Root`.** Because we need the ref-based DOM traversal for roving tabindex, and the user can pass arbitrary children that are not styled by Emotion's child selectors, the styled definition can be inlined onto the `<div>` via `css` prop OR kept as a `styled.div` and rendered as `<Root ref={rootRef} ...>`. Use `styled.div` (the `Root` shown above) for consistency with the rest of UIKit — the JSX becomes `<Root ref={rootRef} role="toolbar" ...>`.

### Step 2 — Create `src/renderer/uikit/Toolbar/index.ts`

```ts
export { Toolbar } from "./Toolbar";
export type { ToolbarProps } from "./Toolbar";
```

### Step 3 — Add Toolbar to `src/renderer/uikit/index.ts`

Insert after the Spacer export (the last layout primitive entry):

```ts
export { Toolbar } from "./Toolbar";
export type { ToolbarProps } from "./Toolbar";
```

### Step 4 — Mark SegmentedControl as a roving host

In [src/renderer/uikit/SegmentedControl/SegmentedControl.tsx](../../../src/renderer/uikit/SegmentedControl/SegmentedControl.tsx) the `Root` element already has `data-type="segmented-control"`. Add `data-roving-host=""` so a containing Toolbar treats it as a single tab stop.

**Before** (lines 153–159):
```tsx
return (
    <Root
        ref={rootRef}
        data-type="segmented-control"
        data-disabled={disabled || undefined}
        role="radiogroup"
    >
```

**After:**
```tsx
return (
    <Root
        ref={rootRef}
        data-type="segmented-control"
        data-roving-host=""
        data-disabled={disabled || undefined}
        role="radiogroup"
    >
```

Also add `e.stopPropagation()` after `e.preventDefault()` on each handled key inside `handleKey` (lines 119–149) so the parent Toolbar's `onKeyDown` does not also fire. Example for ArrowRight:

**Before:**
```tsx
case "ArrowRight":
case "ArrowDown":
    e.preventDefault();
    moveFocus(i, 1);
    break;
```

**After:**
```tsx
case "ArrowRight":
case "ArrowDown":
    e.preventDefault();
    e.stopPropagation();
    moveFocus(i, 1);
    break;
```

Apply the same `e.stopPropagation()` to the ArrowLeft/ArrowUp, Home, and End branches.

### Step 5 — Create `src/renderer/uikit/Toolbar/Toolbar.story.tsx`

```tsx
import React from "react";
import { Toolbar } from "./Toolbar";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Spacer } from "../Spacer/Spacer";
import { Text } from "../Text/Text";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { Story } from "../../editors/storybook/storyTypes";

const ToolbarDemo = (props: any) => {
    const [bg, setBg] = React.useState("default");
    return (
        <Toolbar {...props}>
            <Text variant="caption">Demo:</Text>
            <Button>Action</Button>
            <IconButton icon={resolveIconPreset("save")} aria-label="Save" />
            <Spacer />
            <SegmentedControl
                items={[
                    { value: "default", label: "Default" },
                    { value: "light",   label: "Light"   },
                    { value: "dark",    label: "Dark"    },
                ]}
                value={bg}
                onChange={setBg}
                size="sm"
                background={props.background}
            />
        </Toolbar>
    );
};

export const toolbarStory: Story = {
    id: "toolbar",
    name: "Toolbar",
    section: "Layout",
    component: ToolbarDemo,
    props: [
        { name: "orientation",  type: "enum",    options: ["horizontal", "vertical"], default: "horizontal" },
        { name: "background",   type: "enum",    options: ["default", "light", "dark"], default: "dark" },
        { name: "borderTop",    type: "boolean", default: false },
        { name: "borderBottom", type: "boolean", default: false },
        { name: "disabled",     type: "boolean", default: false },
    ],
};
```

### Step 6 — Register the story in `src/renderer/editors/storybook/storyRegistry.ts`

**Before** (relevant lines):
```ts
// Layout
import { flexStory }   from "../../uikit/Flex/Flex.story";
import { hstackStory } from "../../uikit/Flex/HStack.story";
import { vstackStory } from "../../uikit/Flex/VStack.story";
import { panelStory }  from "../../uikit/Panel/Panel.story";
import { cardStory }   from "../../uikit/Card/Card.story";
import { spacerStory } from "../../uikit/Spacer/Spacer.story";

// Bootstrap
// ...

export const ALL_STORIES: Story[] = [
    flexStory, hstackStory, vstackStory, panelStory, cardStory, spacerStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory,
];
```

**After:**
```ts
// Layout
import { flexStory }    from "../../uikit/Flex/Flex.story";
import { hstackStory }  from "../../uikit/Flex/HStack.story";
import { vstackStory }  from "../../uikit/Flex/VStack.story";
import { panelStory }   from "../../uikit/Panel/Panel.story";
import { cardStory }    from "../../uikit/Card/Card.story";
import { spacerStory }  from "../../uikit/Spacer/Spacer.story";
import { toolbarStory } from "../../uikit/Toolbar/Toolbar.story";

// Bootstrap
// ...

export const ALL_STORIES: Story[] = [
    flexStory, hstackStory, vstackStory, panelStory, cardStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory,
];
```

### Step 7 — Replace `PageToolbar` with `Toolbar` in [StorybookEditorView.tsx](../../../src/renderer/editors/storybook/StorybookEditorView.tsx)

**Before** (line 6 and 61–72):
```tsx
import { PageToolbar } from "../base";
// ...
<PageToolbar>
    <ToolbarTitle>Storybook</ToolbarTitle>
    <HStack gap={spacing.sm} align="center" style={{ marginLeft: "auto" }}>
        <Text variant="caption">Background:</Text>
        <SegmentedControl
            items={BG_OPTIONS}
            value={previewBackground}
            onChange={(v) => model.setPreviewBackground(v as PreviewBackground)}
            size="sm"
        />
    </HStack>
</PageToolbar>
```

**After:**
```tsx
import { Toolbar } from "../../uikit/Toolbar/Toolbar";
// (drop the `PageToolbar` import from "../base"; keep other base imports unchanged)
// ...
<Toolbar borderBottom aria-label="Storybook editor toolbar">
    <ToolbarTitle>Storybook</ToolbarTitle>
    <HStack gap={spacing.sm} align="center" style={{ marginLeft: "auto" }}>
        <Text variant="caption">Background:</Text>
        <SegmentedControl
            items={BG_OPTIONS}
            value={previewBackground}
            onChange={(v) => model.setPreviewBackground(v as PreviewBackground)}
            size="sm"
        />
    </HStack>
</Toolbar>
```

The Toolbar's default `background="dark"` matches the legacy PageToolbar surface visually.

### Step 8 — Manual verification in dev mode

1. `npm start` — open the Storybook page.
2. Top toolbar visually identical to before (dark surface, border-bottom).
3. Open the Toolbar story (Layout → Toolbar). Confirm:
   - Roving tabindex: Tab in → focus on first item; Arrow Right/Left → moves; Home/End → ends; Tab → exits the toolbar.
   - Wraps at ends (Decision #7 — toolbar wraps).
   - Disabled toolbar: Tab does not enter; opacity reduced.
   - Background switcher in StorybookEditorView toolbar drives the preview background; the **Toolbar story's own** `background` prop is auto-injected from the same switcher (managed-prop mechanism), so the toolbar background under inspection matches the surrounding preview.
4. Open any non-Storybook editor (text, video, browser) and confirm `PageToolbar` is unchanged.
5. Inside the Toolbar story, the nested SegmentedControl: Arrow keys while focused inside SegmentedControl move only the segments (not the Toolbar's tab stop); Tabbing out moves focus to the next Toolbar stop or out of the toolbar entirely.

## Concerns and resolutions

### Nested roving widgets (resolved)

A SegmentedControl inside a Toolbar would have arrow keys handled twice if both widgets attach `keydown` and bubble. **Resolution:** SegmentedControl marks itself with `data-roving-host` on its Root and calls `e.stopPropagation()` after handling Arrow/Home/End keys. Toolbar's `useRovingTabIndex` ignores keydowns whose `e.target` is inside a different roving host. Documented in Step 4. This is the contract for any future nested roving widget (Tree inside Toolbar, etc.).

### Vertical orientation (resolved — included but not exercised)

Storybook does not need vertical toolbars. The `orientation` prop is included for API completeness (Decision #7 covers both axes for future Tab bar / Sidebar reuse) but only horizontal is exercised by the Storybook adoption. The vertical path is testable via the Toolbar story.

### `&:empty` rule and fragments (resolved — kept)

PageToolbar collapses when empty. The new Toolbar preserves `&:empty { display: none }`. ComponentSet renders a Fragment, so an empty descriptor array still produces no real children → toolbar collapses correctly.

### `data-bg` vs Button's `data-bg` (no conflict)

Both Toolbar and Button use a `data-bg` attribute — but they live on different elements (Toolbar root vs. Button root). Emotion attribute selectors target their own root only. No CSS conflict.

### Disabled toolbar makes children inert (resolved)

When `disabled` is set on Toolbar, `pointerEvents: none` plus reduced opacity disables visual interaction. The roving hook also sets all stops to `tabIndex=-1` so Tab cannot enter. Individual children's `disabled` props are not modified — that is the caller's responsibility.

### Migration of existing PageToolbar usages (out of scope — by user direction)

Per user instruction, all 11 non-Storybook PageToolbar usages stay on the legacy component. A follow-up task (TBD) will migrate them per editor — that work also requires migrating each editor's toolbar contents (legacy `Button` from `components/basic/`, `FlexSpace`, etc.) to UIKit equivalents, which is substantially larger.

## Acceptance criteria

- [ ] [src/renderer/uikit/Toolbar/Toolbar.tsx](../../../src/renderer/uikit/Toolbar/Toolbar.tsx) implements the API in Step 1, including roving tabindex with end-wrapping
- [ ] `data-type="toolbar"`, `role="toolbar"`, `aria-orientation`, `data-bg`, `data-orientation`, `data-border-top`, `data-border-bottom`, `data-disabled` all set per spec
- [ ] [src/renderer/uikit/Toolbar/index.ts](../../../src/renderer/uikit/Toolbar/index.ts) exports `Toolbar` and `ToolbarProps`
- [ ] [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) re-exports the Toolbar
- [ ] [src/renderer/uikit/SegmentedControl/SegmentedControl.tsx](../../../src/renderer/uikit/SegmentedControl/SegmentedControl.tsx) sets `data-roving-host` and calls `e.stopPropagation()` for handled keys
- [ ] [src/renderer/uikit/Toolbar/Toolbar.story.tsx](../../../src/renderer/uikit/Toolbar/Toolbar.story.tsx) registered in [storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) under section `"Layout"`
- [ ] [StorybookEditorView.tsx](../../../src/renderer/editors/storybook/StorybookEditorView.tsx) uses the new `Toolbar` (drops `PageToolbar` import)
- [ ] Storybook editor toolbar visually unchanged from before this task
- [ ] Tab/Arrow/Home/End behave per Rule 4 in the Toolbar story
- [ ] Nested SegmentedControl inside the Toolbar story handles its own arrow keys without disturbing the Toolbar's roving
- [ ] All other editor toolbars (`PageToolbar` consumers) untouched and rendering identically

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/Toolbar/Toolbar.tsx` | **New** — component + `useRovingTabIndex` hook |
| `src/renderer/uikit/Toolbar/index.ts` | **New** — public exports |
| `src/renderer/uikit/Toolbar/Toolbar.story.tsx` | **New** — Storybook story under section "Layout" |
| `src/renderer/uikit/index.ts` | Add `Toolbar` + `ToolbarProps` exports |
| `src/renderer/uikit/SegmentedControl/SegmentedControl.tsx` | Add `data-roving-host` on Root; `e.stopPropagation()` on handled keys in `handleKey` |
| `src/renderer/editors/storybook/storyRegistry.ts` | Import + register `toolbarStory` in `ALL_STORIES` |
| `src/renderer/editors/storybook/StorybookEditorView.tsx` | Replace `PageToolbar` (from `../base`) with `Toolbar` (from `../../uikit/Toolbar/Toolbar`); drop `PageToolbar` from base imports |

### Files NOT to change

| File | Reason |
|------|--------|
| `src/renderer/editors/base/EditorToolbar.tsx` | Legacy `EditorToolbar` / `PageToolbar` alias kept intact for the 11 non-Storybook editors |
| `src/renderer/editors/{video,browser,archive,text,pdf,mcp-inspector,image,compare,category}/*` | Migration of their toolbars is a separate later task — out of scope |
| `src/renderer/components/basic/*` | Legacy component library — out of scope |
| `src/renderer/uikit/Button/Button.tsx` | Already correct; Button's `background` prop continues to be auto-injected by Storybook's managed-props mechanism when nested in Toolbar |
| All other UIKit components | Toolbar is additive — no changes needed elsewhere in UIKit |
