# US-466: UIKit Popover — overlay primitive

## Goal

Build a UIKit `Popover` component — an anchored floating overlay (border, shadow, rounded corners) that screen migrations can use under [Rule 7](../../../src/renderer/uikit/CLAUDE.md). It is a thin UIKit wrapper around `@floating-ui/react` (the same library the legacy [`Popper`](../../../src/renderer/components/overlay/Popper.tsx) wraps), with the component renamed per the US-438 naming table (`Popper → Popover`), two legacy escape hatches dropped (`resizable`, explicit `tabIndex` prop), one renamed and generalized (`allowClickInClass` → `outsideClickIgnoreSelector`, accepts any CSS selector), `anchorType` simplified away (auto-flip handles it), and **positioning prop names kept exactly as legacy** (`elementRef`, `x`, `y`, `placement`, `offset`) so the existing [`TPopperModel.position`](../../../src/renderer/ui/dialogs/poppers/types.ts) (which is `PopperPosition`) is shape-compatible with `<Popover>` — letting the encapsulated `showSomething()` dialog pattern (see [showPopupMenu.tsx](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx)) carry over to UIKit popovers without an adapter layer.

This task **builds the component only**. Existing legacy `Popper` consumers are not migrated here — they continue to use legacy `Popper` and migrate one-by-one as their parent screens reach Phase 4. The first consumer of UIKit `Popover` will be [US-463 BrowserDownloadsPopup](../US-463-browser-downloads-migration/README.md), which is blocked on this task.

## Background

### EPIC-025 Phase 4 context

[EPIC-025](../../epics/EPIC-025.md) Phase 4 is per-screen migration, but that loop assumes the UIKit catalog has the primitives each screen needs. When several upcoming screens share a missing primitive (here: an anchored floating overlay), it's cheaper to build the primitive once than to repeat "screen + tiny extension + screen + tiny extension". The same pattern applies to the planned [US-432 Dialog](../../epics/EPIC-025.md) (modal overlay) and the upcoming **US-467 Tooltip** placeholder — three pieces of overlay infrastructure that unblock the next several Phase 4 migrations.

Naming: per the [US-438 naming table](../US-438-pattern-research/README.md), `Popper → Popover`. The component lives at `src/renderer/uikit/Popover/`.

### Audit of legacy `Popper`

[`src/renderer/components/overlay/Popper.tsx`](../../../src/renderer/components/overlay/Popper.tsx) — 341 lines.

#### Library

`@floating-ui/react`. Already in the project's dependencies (consumed by the legacy `Popper`); no new package to install.

Imports legacy uses:
```ts
import {
    Placement, useFloating, VirtualElement,
    offset as floatingOffset, flip, useMergeRefs, autoUpdate, size,
} from "@floating-ui/react";
```

The UIKit Popover uses the same set.

#### Behavior

| Legacy behavior | Keep? | Notes |
|---|---|---|
| Anchor by element ref (`elementRef: Element \| VirtualElement`) | **keep, name unchanged** — name stays `elementRef` so that `PopoverPosition` is structurally identical to legacy `PopperPosition` (the encapsulated dialog pattern in [`ui/dialogs/poppers/`](../../../src/renderer/ui/dialogs/poppers/) carries `position: PopperPosition` on `TPopperModel`; renaming would break shape compat without value). Type is `Element \| VirtualElement \| null`. |
| Anchor by virtual point (`x, y` numbers) | **keep** — same `x?: number; y?: number` props. The component constructs a `VirtualElement` internally when these are set. |
| `placement: Placement` | **keep** — same union from `@floating-ui/react`. Default: `"bottom-start"` (legacy default). |
| `offset: [skidding, distance]` | **keep** — same shape. Forwarded to floating-ui's `offset({ mainAxis, crossAxis })`. |
| Auto-flip middleware (legacy: vertical and horizontal placement lists based on `anchorType`) | **simplified** — drop `anchorType`. Use floating-ui's default `flip()` middleware (auto-derives fallbacks from the requested placement). One less prop, same behavior for any sane placement. |
| `size` middleware capping max-height to `availableHeight - 20` | **keep** — same auto-cap so a popover near the viewport edge becomes scrollable instead of overflowing. |
| `maxHeight` prop (caller override) | **keep** — same prop, applied as inline style. |
| `onClose` called on click-outside + Esc | **keep** — same. |
| `onKeyDown` (forwarded to root `<div>`) | **keep** — same shape. Useful for arrow-key navigation in suggestion lists. |
| `resizable` + `onResize` + `<ResizeHandleIcon>` corner | **drop** — legacy escape hatch with one current real consumer (AVGrid filter); stays in legacy `Popper` until that screen migrates and a concrete need surfaces in UIKit. Adding it later is a single styled-rule + handler. |
| `allowClickInClass` | **keep, rename to `outsideClickIgnoreSelector`** — load-bearing for nested menus (every `PopupMenu` and submenu shares the `popup-menu` class so clicks in submenus don't close the parent) and for sticky input dropdowns (`PathInput` uses it so clicking the input itself doesn't close the suggestions). Generalized from "class name" to "any CSS selector" so UIKit consumers can pass data-attribute selectors (`'[data-type="menu"]'`) under Rule 7. See the dedicated section below. |
| `tabIndex` prop | **drop as explicit prop** — caller can spread `tabIndex` via `...rest` since `PopoverProps extends HTMLAttributes<HTMLDivElement>`. |
| `position: "fixed"` strategy + `z-index: 1000` | **keep** — fixed positioning lets the popover overlay any scroll container; 1000 sits above page content but below modal dialogs. |
| `autoUpdate` (recompute on scroll/resize) | **keep** — same. |
| Returns `null` when not open / no anchor | **keep** — no DOM cost when closed. |

#### Visual / layout

Legacy `PopperRoot`:
```ts
backgroundColor: color.background.default,
border: `1px solid ${color.border.default}`,
borderRadius: 6,
boxShadow: color.shadow.default,
position: "relative",
display: "flex",
flexDirection: "column",
alignItems: "stretch",
WebkitAppRegion: "no-drag",
overflow: "auto",
```

UIKit Popover root:
- `background: color.background.default` ✓
- `border: 1px solid color.border.default` ✓
- `borderRadius: radius.lg` (= 6) ✓
- `boxShadow: color.shadow.default` ✓
- `overflow: auto` ✓ (lets content scroll when capped by maxHeight)
- `WebkitAppRegion: "no-drag"` ✓ (prevents the popover from acting as a window-drag region inside the frameless Electron window)

Drop the implicit `display: flex; flex-direction: column; align-items: stretch`. Consumers wrap their content in a `<Panel>` (which already has flex defaults), so the Popover root stays neutral and doesn't compete with the consumer's chosen layout. This matches the [Spacer / Panel composition pattern](../../../src/renderer/uikit/CLAUDE.md) where layout responsibility lives in the consumer's Panel, not the wrapping primitive.

#### Portaling — change from legacy

Legacy `Popper` returns its floating element inline in the React tree; some consumers wrap it in `ReactDOM.createPortal` manually ([ColumnsOptions.tsx:319](../../../src/renderer/editors/grid/components/ColumnsOptions.tsx#L319), [CsvOptions.tsx:78](../../../src/renderer/editors/grid/components/CsvOptions.tsx#L78)), others do not ([BrowserDownloadsPopup.tsx](../../../src/renderer/editors/browser/BrowserDownloadsPopup.tsx)). The inconsistency is a bug surface — when a popover is rendered inside an `overflow: hidden` container, the floating box gets clipped.

**UIKit Popover portals by default** to `document.body` via `ReactDOM.createPortal`. This is the correct default — `position: fixed` already makes the visual overlay viewport-relative, so portal-by-default just frees the popover from accidental clipping by ancestor stacking contexts. No prop is needed; no consumer ever needs *not* to portal.

#### Existing legacy consumers (NOT migrated in this task)

| File | Status |
|------|--------|
| [components/overlay/PopupMenu.tsx](../../../src/renderer/components/overlay/PopupMenu.tsx) | Stays on legacy. Migrates as part of UIKit `Menu` (separate task). |
| [components/form/ComboTemplate.tsx](../../../src/renderer/components/form/ComboTemplate.tsx) | Stays on legacy. Migrates with UIKit `ComboBox` / `Select` (separate task). |
| [components/data-grid/AVGrid/filters/FilterPoper.tsx](../../../src/renderer/components/data-grid/AVGrid/filters/FilterPoper.tsx) | Stays on legacy. AVGrid is Phase-5 adopt-in-place; filter popper rides with it. |
| [components/basic/PathInput.tsx](../../../src/renderer/components/basic/PathInput.tsx) | Stays on legacy. Migrates with UIKit `PathInput` (separate task). |
| [editors/grid/components/CsvOptions.tsx](../../../src/renderer/editors/grid/components/CsvOptions.tsx) | Stays on legacy until grid editor migrates. |
| [editors/grid/components/ColumnsOptions.tsx](../../../src/renderer/editors/grid/components/ColumnsOptions.tsx) | Stays on legacy until grid editor migrates. |
| [editors/browser/BrowserDownloadsPopup.tsx](../../../src/renderer/editors/browser/BrowserDownloadsPopup.tsx) | **First UIKit consumer — migrated in [US-463](../US-463-browser-downloads-migration/README.md) right after this task lands.** |

`TPopperModel` and `IPopperViewData` ([ui/dialogs/poppers/types.ts](../../../src/renderer/ui/dialogs/poppers/types.ts)) reference `PopperPosition` from legacy `Popper`. They are part of the legacy popper-as-dialog system and stay paired with legacy `Popper`. UIKit Popover is for inline-mounted floating overlays; the dialog/popper model used by `showPopper()` will continue to use legacy `Popper` until it is also migrated.

### Files involved

| File | Role | Change |
|------|------|--------|
| `src/renderer/uikit/Popover/Popover.tsx` | UIKit Popover component | **New** |
| `src/renderer/uikit/Popover/Popover.story.tsx` | Storybook story | **New** |
| `src/renderer/uikit/Popover/index.ts` | Folder barrel export | **New** |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit public exports | Add `Popover` + `PopoverProps` |
| [src/renderer/editors/storybook/storyTypes.ts](../../../src/renderer/editors/storybook/storyTypes.ts) (registry — verify path during implementation) | Story registry | Register `popoverStory` |
| [doc/active-work.md](../../active-work.md) | Dashboard | Convert US-466 line to a markdown link to this README |

### Files NOT changed

- `components/overlay/Popper.tsx` — legacy stays in place. Will be removed only after **all** consumers migrate (final step of EPIC-025 Phase 4).
- All 7 legacy consumers listed above — none touched here.
- `ui/dialogs/poppers/Poppers.tsx`, `showPopupMenu.tsx`, `types.ts` — legacy popper-dialog system unchanged.

## Implementation plan

### Step 1 — Create `Popover.tsx`

Path: `src/renderer/uikit/Popover/Popover.tsx`. Single-file component, ~150 lines.

Public API:

```tsx
/**
 * Positioning subset of `PopoverProps`. Shape-identical to legacy `PopperPosition`
 * (minus `anchorType` which is dropped). This is the canonical position type going
 * forward — `TPopperModel.position` and any encapsulated `showSomething()` module
 * can spread a `PopoverPosition` straight into `<Popover>`.
 */
export interface PopoverPosition {
    elementRef?: Element | VirtualElement | null;
    x?: number;
    y?: number;
    placement?: Placement;
    offset?: [number, number];
}

export interface PopoverProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">,
        PopoverPosition {
    /** Whether the popover is rendered. When false, no DOM is mounted. */
    open: boolean;
    /** Called on click-outside or Escape. */
    onClose?: () => void;
    /** Caller-set max-height override. Number → px. The component also auto-caps to viewport. */
    maxHeight?: number | string;
    /**
     * Any CSS selector. A click outside the popover that lands on an element matching this
     * selector (or having an ancestor that matches) does NOT trigger `onClose`. Use for
     * sibling-rendered children — e.g. submenus that share a family attribute, or an anchor
     * input where clicking the input itself should keep the dropdown open. Replaces and
     * generalizes legacy Popper's `allowClickInClass` (which only accepted a class name).
     */
    outsideClickIgnoreSelector?: string;
    children?: React.ReactNode;
}
```

Internal:

```tsx
import React, { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import {
    Placement, useFloating, VirtualElement,
    offset as floatingOffset, flip, useMergeRefs, autoUpdate, size,
} from "@floating-ui/react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { radius } from "../tokens";

const Root = styled.div(
    {
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: radius.lg,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        overflow: "auto",
        WebkitAppRegion: "no-drag",
    },
    { label: "Popover" },
);

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
    {
        open,
        elementRef,
        x, y,
        placement = "bottom-start",
        offset,
        onClose,
        onKeyDown,
        maxHeight,
        outsideClickIgnoreSelector,
        children,
        ...rest
    },
    ref,
) {
    const placeRef = useMemo<Element | VirtualElement | undefined>(() => {
        if (elementRef) return elementRef;
        if (x !== undefined && y !== undefined) {
            return {
                getBoundingClientRect: () => ({
                    top: y, left: x, bottom: y, right: x, width: 0, height: 0,
                }),
            } as VirtualElement;
        }
        return undefined;
    }, [elementRef, x, y]);

    const middleware = useMemo(() => {
        const m = [
            flip(),
            size({
                apply({ availableHeight, elements }) {
                    Object.assign(elements.floating.style, {
                        maxHeight: `${Math.max(100, availableHeight - 20)}px`,
                    });
                },
            }),
        ];
        if (offset) {
            m.unshift(floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] }));
        }
        return m;
    }, [offset]);

    const onOpenChange = useCallback((value: boolean) => {
        if (value) onClose?.();
    }, [onClose]);

    const { refs, floatingStyles, placement: actualPlacement } = useFloating({
        open,
        onOpenChange,
        placement,
        middleware,
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
    });

    const internalRef = useRef<HTMLDivElement | null>(null);
    const mergedRefs = useMergeRefs([refs.setFloating, ref, internalRef]);

    useEffect(() => {
        refs.setPositionReference(placeRef ?? null);
    }, [placeRef, refs]);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!internalRef.current || internalRef.current.contains(event.target as Node)) return;
            if (outsideClickIgnoreSelector) {
                const target = event.target as Element | null;
                if (target?.closest(outsideClickIgnoreSelector)) return;
            }
            onClose?.();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose?.();
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, onClose, outsideClickIgnoreSelector]);

    if (!open || !placeRef) return null;

    return ReactDOM.createPortal(
        <Root
            ref={mergedRefs}
            data-type="popover"
            data-placement={actualPlacement}
            onKeyDown={onKeyDown}
            {...rest}
            style={{ ...floatingStyles, zIndex: 1000, ...(maxHeight ? { maxHeight } : {}) }}
        >
            {children}
        </Root>,
        document.body,
    );
});
```

Notes:
- Uses `forwardRef` because legacy consumers do (e.g. ComboTemplate stores a ref to the popper). UIKit consumers may need it too (e.g. capturing the popover for measurement).
- `data-type="popover"` per Rule 1.
- `data-placement={actualPlacement}` exposes the resolved placement (after auto-flip) for DevTools / agent inspection.
- `style={{ ...floatingStyles, zIndex: 1000, ...maxHeight }}` is internal styling on UIKit's own root — allowed (Rule 7 only forbids style on UIKit components from app code; the component implements its own root with style to integrate with floating-ui's positioning output, exactly like every other UIKit component combines styled rules with computed inline styles).
- The component returns `null` when `!open || !placeRef`. No DOM cost when closed; no error when consumer hasn't supplied an anchor yet.
- Click-outside and Escape are mounted only while `open` (effect dependency on `open`) — avoids running listeners for closed popovers.
- The `data-type` attribute placement at the top of the spread, with `style` last, ensures consumer's `...rest` cannot accidentally override `data-type` or the floating styles.

### Step 2 — Create `index.ts`

Path: `src/renderer/uikit/Popover/index.ts`:

```ts
export { Popover } from "./Popover";
export type { PopoverProps, PopoverPosition } from "./Popover";
```

### Step 3 — Update UIKit barrel

[`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) — add after the existing exports:

```ts
export { Popover } from "./Popover";
export type { PopoverProps, PopoverPosition } from "./Popover";
```

### Step 4 — Create `Popover.story.tsx`

Path: `src/renderer/uikit/Popover/Popover.story.tsx`. Storybook entry that renders an open popover anchored to a visible button so the user can play with placement/offset/maxHeight.

```tsx
import React, { useRef, useState } from "react";
import { Popover } from "./Popover";
import { Story } from "../../editors/storybook/storyTypes";

const PLACEMENTS = [
    "top", "top-start", "top-end",
    "bottom", "bottom-start", "bottom-end",
    "left", "left-start", "left-end",
    "right", "right-start", "right-end",
];

function PopoverPreview(props: any) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
        <div style={{ padding: 80 }}>
            <button ref={anchorRef} onClick={() => setOpen((v) => !v)}>
                Toggle popover
            </button>
            <Popover {...props} open={open} elementRef={anchorRef.current} onClose={() => setOpen(false)}>
                <div style={{ padding: 12, minWidth: 180 }}>
                    Hello from Popover
                </div>
            </Popover>
        </div>
    );
}

export const popoverStory: Story = {
    id: "popover",
    name: "Popover",
    section: "Overlay",
    component: PopoverPreview as any,
    props: [
        { name: "placement", type: "enum", options: PLACEMENTS, default: "bottom-start" },
        { name: "maxHeight", type: "string", default: "" },
    ],
};
```

Design notes for the story:
- An anchor button is required for floating-ui to position against; the story renders one and uses its ref as the `anchor`.
- The story uses raw `<div style={{}}>` for the inline preview content because `<div>` here is leaf content inside a Storybook preview, not part of UIKit composition. Acceptable per Rule 7's scope (style on UIKit components is forbidden; raw HTML is fine).
- A future iteration can add an `x`/`y` virtual-anchor demo, but the anchor-element flow is the common case.

### Step 5 — Register the story

The story registry path is wherever `panelStory`, `spinnerStory`, etc. are aggregated (likely [`src/renderer/editors/storybook/storyTypes.ts`](../../../src/renderer/editors/storybook/storyTypes.ts) or a sibling barrel). Locate the registry, import `popoverStory`, append it to the array. Confirm during implementation.

### Step 6 — TypeScript check

`npx tsc --noEmit` — no new errors on `Popover.tsx`, `Popover.story.tsx`, `uikit/index.ts`.

### Step 7 — Manual smoke test (Storybook)

Run the app, open the Storybook editor, navigate to "Popover" under the "Overlay" section. Verify:
- Toggle the anchor button → popover opens/closes
- Cycle placements → position updates
- Set maxHeight to e.g. `200` → popover scrolls when content overflows
- Click outside → popover closes (`onClose` fires)
- Press Escape → popover closes
- Inspect DevTools → root has `data-type="popover"`, `data-placement="bottom-start"` (or whichever resolved); the popover sits inside `<body>` (portaled).

### Step 8 — Update dashboard

Already handled at task creation — entry on the dashboard is a link to this README.

## Concerns / Open questions

All resolved before implementation.

### 1. Should we also migrate legacy consumers in this task? — RESOLVED: no

Per EPIC-025's per-screen migration philosophy, legacy `Popper` stays in place. The 7 legacy consumers each migrate as part of their own screen migration (BrowserDownloadsPopup is US-463 next; PathInput, ComboTemplate, AVGrid filters, ColumnsOptions, CsvOptions, PopupMenu are separate future tasks). UIKit Popover is built once and adopted screen-by-screen.

### 2. Auto-portal — change from legacy. Is that the right default? — RESOLVED: yes

Legacy `Popper` does not portal; some consumers wrap manually in `ReactDOM.createPortal`. The inconsistency causes clipping bugs when a popover sits inside an `overflow: hidden` ancestor. UIKit Popover's `position: fixed` strategy already detaches the visual overlay from ancestor scroll — portaling makes that complete by also detaching from ancestor stacking contexts. There is no real downside (the click-outside listener uses `document.addEventListener`, so portal vs in-tree doesn't affect dismissal logic).

### 3. Drop `resizable` / `onResize` / resize handle — does any UIKit consumer need this? — RESOLVED: no

The only legacy consumer that uses `resizable` is `FilterPoper` ([data-grid/AVGrid/filters/FilterPoper.tsx](../../../src/renderer/components/data-grid/AVGrid/filters/FilterPoper.tsx)), which is part of AVGrid (Phase 5 adopt-in-place — not a UIKit migration target). When AVGrid is touched in Phase 5, the filter popper either stays on legacy `Popper` or gets a small UIKit extension at that time. Adding `resizable` later is a self-contained change (one styled rule + a pointer-handler) — no design lock-in.

### 4. `allowClickInClass` — keep or drop? — RESOLVED: keep, rename and generalize

Initial review proposed dropping `allowClickInClass` as a "legacy escape hatch". Re-investigation found two **load-bearing** consumers:

1. **[PopupMenu.tsx:344](../../../src/renderer/components/overlay/PopupMenu.tsx#L344)** — nested menu pattern. Every `PopupMenu` instance and each opened submenu carries the same shared class (`popup-menu`). The parent menu's click-outside handler uses `closest('.popup-menu')` to detect "click inside the menu family" — including any submenu, which is rendered as a sibling Popper, not a DOM child. Without this, clicking an item in a submenu closes the parent menu before the submenu's `onClick` fires; the click is dropped on the floor.
2. **[PathInput.tsx:424](../../../src/renderer/components/basic/PathInput.tsx#L424)** — sticky input dropdown. The suggestions popup is anchored to the input. Clicking the input itself (cursor positioning, text selection) is technically outside the popup's DOM. Without this, every click in the input closes the dropdown — bad UX.

Removing the feature would break both patterns. Replicating them ad-hoc per consumer (event.stopPropagation in dozens of places, or a custom click-outside handler in each menu) is worse than a single small Popover prop.

**Resolution**: keep the feature. Rename `allowClickInClass: string` (only accepts a CSS class name) to `outsideClickIgnoreSelector: string` (accepts any CSS selector). Mechanism is `(event.target as Element).closest(selector)` either way — the rename just makes any selector type work, including data-attribute selectors that UIKit conventions favor (e.g. `'[data-type="menu"]'`).

**Migration mapping for the two patterns:**
- Future UIKit `Menu` (replacing `PopupMenu`) sets `data-type="menu"` on its root and passes `outsideClickIgnoreSelector='[data-type="menu"]'` to its Popover. Submenus also have `data-type="menu"`, so the same selector matches the whole family.
- Future UIKit `PathInput` (replacing the legacy one) sets `data-type="path-input"` on its wrapper and passes `outsideClickIgnoreSelector='[data-type="path-input"]'`.

Both translate cleanly to UIKit's data-attribute conventions. No ad-hoc class names required in app code.

### 5. Default placement — `"bottom-start"` matches legacy? — RESOLVED: yes

Legacy: when no placement is provided and `anchorType` is `"vertical"` (the default), the resolved placement is `"bottom-start"`. UIKit Popover keeps `"bottom-start"` as the default and drops `anchorType` entirely (the `flip()` middleware derives reasonable fallbacks from any starting placement, so the prop adds no value).

### 6. `data-state="open" | "closed"` attribute? — RESOLVED: no, returning null is enough

Some libraries (Radix, Headless UI) keep the popover mounted with `data-state` for animation hooks. UIKit Popover does not animate today; mounting only when `open === true` is simpler and has zero DOM cost when closed. If exit-animation requirements emerge, `data-state` and `unmount: false` can be added without breaking the existing API.

### 7. `WebkitAppRegion: "no-drag"` — necessary in 2026? — RESOLVED: yes, keep

Persephone runs in a frameless Electron window; the title bar uses `WebkitAppRegion: "drag"`. Children of the drag-region inherit unless they opt out. Without `no-drag` on a popover, clicks on the popover would trigger window-drag instead of clicking the content. Same defensive copy as legacy. Cheap to keep; expensive to debug if dropped.

### 8. Ref forwarding — needed? — RESOLVED: yes

Legacy `Popper` is forwarded-ref. Several legacy consumers store a ref to the popper element. UIKit Popover keeps `forwardRef<HTMLDivElement>` so future consumers can do the same (e.g. measuring popover size, focus management on open).

### 9. Folder placement — `uikit/Popover/` not `uikit/overlay/Popover/`? — RESOLVED: flat folder

Existing UIKit folders are flat (`uikit/Panel/`, `uikit/Button/`, etc.). Following the same convention. The Storybook section can group overlay components under `"Overlay"` regardless of folder layout.

### 10. Position-prop shape compatibility with legacy `TPopperModel.position` — RESOLVED: keep legacy names

Persephone has an encapsulated dialog pattern in [`src/renderer/ui/dialogs/poppers/`](../../../src/renderer/ui/dialogs/poppers/) that wraps an anchored popover behind a `showSomething()` async function (see [showPopupMenu.tsx](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx)). The pattern is:

1. Define a model class extending `TPopperModel<TState, TResult>` with `position: PopperPosition`.
2. Define a view component that reads the model and renders a popper anchored by `model.position`.
3. Register the view via `Views.registerView(viewId, ViewComponent)`.
4. Export `showSomething(args): Promise<R>` — creates the model, calls `showPopper({ viewId, model })` (which inserts it into the global [`<Poppers/>`](../../../src/renderer/ui/dialogs/poppers/Poppers.tsx) registry), returns the promise that resolves when the model closes.

The pattern works because `TPopperModel.position` is `PopperPosition` and `<Popper {...position}>` is valid (legacy `PopperProps extends PopperPosition`).

For UIKit popovers built using the same pattern (US-463 will be the first), `TPopperModel.position` (or its UIKit successor) needs to be spreadable into `<Popover>` directly — i.e. `PopoverPosition` and `PopperPosition` must be structurally identical (modulo dropped fields like `anchorType`).

**Decision**: keep the legacy positioning prop names (`elementRef`, `x`, `y`, `placement`, `offset`) on UIKit Popover. Export `PopoverPosition` as the canonical positioning type. It is a structural subset of legacy `PopperPosition` (minus `anchorType`), so:

- Existing `TPopperModel<T, R>` instances (with `position: PopperPosition`) can be migrated to anchor a UIKit Popover **without an adapter layer** — the field names match.
- New encapsulated modules (e.g. `showDownloadsPopup` in US-463) can use `PopoverPosition` directly on their own model class.

The cosmetic appeal of renaming `elementRef → anchor` (closer to Radix/Headless naming) is real but does not justify breaking shape compat with a load-bearing internal pattern. Renaming can happen as part of a separate cleanup task once the legacy `Popper` is fully removed.

## Acceptance criteria

1. `src/renderer/uikit/Popover/Popover.tsx` exists and exports `Popover` (forwardRef) + `PopoverProps` + `PopoverPosition`.
2. `src/renderer/uikit/index.ts` re-exports `Popover`, `PopoverProps`, and `PopoverPosition`.
3. `src/renderer/uikit/Popover/Popover.story.tsx` renders an interactive popover with placement and maxHeight props in the Storybook editor.
4. The Popover root sets `data-type="popover"` and `data-placement="<resolved>"`.
5. The Popover renders into `document.body` via `ReactDOM.createPortal`.
6. `npx tsc --noEmit` reports no new errors on `Popover.tsx`, `Popover.story.tsx`, `uikit/index.ts`.
7. **Smoke test — open/close**: Toggle the anchor button. Popover mounts when `open === true`, unmounts when `open === false`. No DOM nodes left behind.
8. **Smoke test — anchored placement**: With `placement="bottom-start"`, popover sits below-left of the anchor with the configured offset. With `placement="top-end"`, it sits above-right. Auto-flip kicks in when the anchor is near a viewport edge (e.g. at the bottom of the viewport, `bottom-start` flips to `top-start`).
9. **Smoke test — virtual anchor**: With `elementRef={null}` and `x={300}, y={400}`, popover positions at the virtual point.
10. **Smoke test — click-outside dismissal**: With popover open, click anywhere outside it. `onClose` fires; popover unmounts.
11. **Smoke test — Escape dismissal**: With popover open and focus anywhere, press Escape. `onClose` fires.
12. **Smoke test — viewport cap**: Anchor near the bottom of the viewport with content taller than the available space. Popover caps its height (auto-set max-height) and scrolls internally.
13. **Smoke test — caller maxHeight**: Pass `maxHeight={120}`. Popover never exceeds 120px tall, regardless of content.
14. **Smoke test — `outsideClickIgnoreSelector`**: Render a popover and a sibling element marked with `data-test-ignore="true"`. Pass `outsideClickIgnoreSelector='[data-test-ignore="true"]'`. Click the sibling — popover stays open. Click anywhere else outside — popover closes.
15. **Smoke test — themes**: Cycle `default-dark`, `light-modern`, `monokai`. Popover background, border, shadow update with theme.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/Popover/Popover.tsx` | Create | UIKit Popover component, ~150 lines |
| `src/renderer/uikit/Popover/Popover.story.tsx` | Create | Storybook story with anchor button + placement/maxHeight props |
| `src/renderer/uikit/Popover/index.ts` | Create | Folder barrel export |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Modify | Re-export `Popover` and `PopoverProps` |
| Story registry (path TBD during impl — likely [editors/storybook/storyTypes.ts](../../../src/renderer/editors/storybook/storyTypes.ts) or sibling barrel) | Modify | Register `popoverStory` |
| [doc/active-work.md](../../active-work.md) | Modify | Convert US-466 entry to a markdown link to this README |
