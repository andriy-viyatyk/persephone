# US-473: UIKit Popover — resizable mode

**Epic:** EPIC-025 (Phase 4 — overlay infrastructure)
**Builds on:** US-466 (UIKit Popover)
**Status:** Planned

---

## Goal

Add an opt-in `resizable` mode to UIKit `Popover`. When enabled, a resize handle appears in the bottom-right corner; dragging it lets the user grow the popover beyond its initial / anchor-matched size to read long content. After a manual drag, the popover holds its new size for the rest of the open session and stops auto-tracking the anchor's width (so an `autoUpdate` re-layout does not snap it back). On close, the manual size is discarded — opening the popover again starts from the initial / anchor-matched size.

This is a port of the legacy `Popper.resizable` feature (`src/renderer/components/overlay/Popper.tsx:332`), used by `ComboSelect` so users could enlarge the dropdown when the input is too narrow to display long item labels in full. UIKit `Select` (US-472) and any future popover-anchored components (Autocomplete, MultiSelect, popover-with-tree) will adopt it via a single `resizable` prop pass-through.

---

## Background

### Legacy reference

`src/renderer/components/overlay/Popper.tsx`:

- `resizable?: boolean` — opt-in.
- `onResize?: (width: number, height: number) => void` — callback fired on each resize tick.
- A custom `<ResizeHandleIcon>` SVG is rendered at the bottom-right corner.
- `onPointerDown` on the handle captures the pointer; `pointermove` computes new width/height and writes `style.setProperty('width' | 'height', '${px}px')` directly on the popper root. Min-size is enforced (the user can only grow the popper, not shrink below its initial open size).
- The handle flips to top-right when `actualPlacement` puts the popover above the anchor (`isTopPlacement`) — drag direction inverts so dragging down still grows the popper.

`ComboSelect.tsx` consumes it:

```tsx
const [resized, setResized] = useState(false);
const handleResize = useCallback(() => setResized(true), []);
// Inside the dropdown body:
const width = resized ? "unset" : comboTemplateRef.current?.input?.clientWidth ?? 200;
```

So once `onResize` fires, `resized=true` and the inner content's width becomes `"unset"` — the user's manual width on the popper drives layout.

### Interaction with `matchAnchorWidth`

UIKit Popover already supports `matchAnchorWidth` (US-466). The size middleware re-applies the anchor's width on every layout tick (`autoUpdate` reacts to scroll / resize / element-resize events). For `resizable + matchAnchorWidth` to coexist, the popover must remember "the user has manually resized" and stop applying `rects.reference.width` for the rest of the open session.

### EPIC-025 rules in scope

- **Rule 1 (data attributes):** add `data-resizable` / `data-resized` to the popover root for state-driven styling and DOM querying.
- **Rule 7 (no Emotion outside UIKit):** the resize handle is rendered by Popover itself; consumers only flip the `resizable` boolean.

---

## API

```ts
export interface PopoverProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">,
        PopoverPosition {
    open: boolean;
    onClose?: () => void;
    maxHeight?: number | string;
    outsideClickIgnoreSelector?: string;
    matchAnchorWidth?: boolean;
    /**
     * When true, a resize handle is rendered at the bottom-right corner. The user
     * can drag it to grow the popover above its initial / anchor-matched size.
     * Once the user has dragged, the popover keeps its new size for the rest of
     * the open session — `matchAnchorWidth` no longer re-applies. On close, the
     * manual size is discarded; opening again starts fresh.
     */
    resizable?: boolean;
    /** Fired during a drag with the live `(width, height)`. Optional. */
    onResize?: (width: number, height: number) => void;
    children?: React.ReactNode;
}
```

Consumer side, US-472 Select adopts it with a one-line change:

```tsx
<Popover
    open={open}
    onClose={() => setOpen(false)}
    elementRef={rootRef.current}
    matchAnchorWidth
    resizable                         // ← new
    outsideClickIgnoreSelector={...}
>
    <ListBox ... />
</Popover>
```

No state needed in Select itself — Popover handles the manual-size lifecycle.

---

## Implementation plan

### Step 1 — Add resize handle visual

**File:** `src/renderer/uikit/Popover/Popover.tsx`

- Import a 12×12 corner-glyph icon. Two diagonal lines (bottom-right pointing inward) — same shape as legacy `ResizeHandleIcon` (`src/renderer/theme/icons.tsx`). Reuse it; if not exported from the icons module yet, export it. (Do **not** create a new copy — extending `theme/icons.tsx` is the right home.)
- Render the handle inside `Root` only when `resizable` is true. Position absolute, bottom-right, 4px inset.
- When the popover renders above the anchor (`actualPlacement` starts with `top`), put the handle at the top-right and flip the diagonal direction. Use `data-edge="top" | "bottom"` on the handle and let the styled rule rotate the icon.
- The handle has `cursor: nwse-resize` (or `nesw-resize` for the top variant).

### Step 2 — Drag logic with pointer capture

Mirror the legacy implementation from `src/renderer/components/overlay/Popper.tsx:244-312`:

```ts
const internalRef = useRef<HTMLDivElement | null>(null);
const initialSizeRef = useRef<{ width: number; height: number } | null>(null);
const [manualSize, setManualSize] = useState<{ width: number; height: number } | null>(null);

const onHandlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.buttons !== 1) return;
    const root = internalRef.current;
    if (!root) return;

    if (!initialSizeRef.current) {
        const rect = root.getBoundingClientRect();
        initialSizeRef.current = { width: rect.width, height: rect.height };
    }

    const startRect = root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const isTop = actualPlacement.startsWith("top");

    function onPointerMove(e: PointerEvent) {
        if (!initialSizeRef.current || !internalRef.current) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = isTop ? -(e.clientY - startY) : e.clientY - startY;
        const w = startRect.width + dx;
        const h = startRect.height + dy;
        if (w > initialSizeRef.current.width && h > initialSizeRef.current.height) {
            setManualSize({ width: w, height: h });
            onResize?.(w, h);
        }
    }
    function onLost() {
        const tgt = internalRef.current;
        if (tgt) {
            tgt.removeEventListener("pointermove", onPointerMove);
            tgt.removeEventListener("lostpointercapture", onLost);
        }
    }
    root.setPointerCapture(event.pointerId);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("lostpointercapture", onLost);
};
```

Differences from legacy:
- Set React state `manualSize` instead of writing inline style directly. Inline style is then driven by the `manualSize` value through `floatingStyles` merge.
- Reset `manualSize` and `initialSizeRef` when `open` flips false → true (next open starts fresh).

```ts
useEffect(() => {
    if (!open) {
        setManualSize(null);
        initialSizeRef.current = null;
    }
}, [open]);
```

### Step 3 — Size override when `manualSize` is set

The size middleware currently does:

```ts
if (matchAnchorWidth) {
    styles.width = `${rects.reference.width}px`;
}
```

Add a guard to skip width matching once the user has resized:

```ts
if (matchAnchorWidth && !manualSize) {
    styles.width = `${rects.reference.width}px`;
}
```

`manualSize` lives in component state; the middleware closure doesn't see it. Two options:

- **Option A (simple, chosen):** Read `manualSize` via a ref (`manualSizeRef.current`) so the middleware always reads the latest value without re-creating the middleware. Update the ref alongside state.

- **Option B:** Recreate the middleware array when `manualSize` changes. Causes floating-ui to re-mount its layout. Heavier, no real benefit here.

Implementation (Option A):

```ts
const manualSizeRef = useRef<typeof manualSize>(null);
useEffect(() => { manualSizeRef.current = manualSize; }, [manualSize]);

// inside size middleware apply():
if (matchAnchorWidth && !manualSizeRef.current) {
    styles.width = `${rects.reference.width}px`;
}
```

Then apply `manualSize` directly on `Root`'s inline style alongside `floatingStyles`:

```tsx
<Root
    ref={mergedRefs}
    style={{
        ...floatingStyles,
        ...(manualSize && { width: manualSize.width, height: manualSize.height }),
        zIndex: 1000,
        ...(maxHeight && { maxHeight }),
    }}
    ...
/>
```

`floatingStyles` from `useFloating` carries position; `manualSize` overrides width/height when set. Order matters — `manualSize` after `floatingStyles`.

### Step 4 — Inner content sizing

Legacy ComboSelect needed `width: "unset"` on the dropdown body when resized. UIKit's `Select`/`ListBox` does **not** have this issue: when no `width` is set on a flex item, it grows to fill the container. Verify in storybook.

If a future consumer renders fixed-width content inside Popover, they'll size it themselves; Popover doesn't reach into children.

### Step 5 — Data attributes

Add to `Root`:
- `data-resizable=""` when `resizable` is true.
- `data-resized=""` when `manualSize` is non-null.

Drives DOM-query observability (Rule 1) and lets future style overrides target resized state without re-renders.

### Step 6 — Storybook entry

Update `src/renderer/uikit/Popover/Popover.story.tsx` to add a `resizable` boolean control. Demo: anchor button, popover with placeholder text + a long line that overflows when popover is small. User can drag the corner handle to enlarge.

Also update `src/renderer/uikit/Select/Select.story.tsx` to add a `resizable` boolean control showing the Select-with-resizable-dropdown end-to-end.

### Step 7 — Wire through to Select

Pass-through in `src/renderer/uikit/Select/Select.tsx`:

```tsx
export interface SelectProps<T = IListBoxItem> extends ... {
    ...
    /** When true, the dropdown popover gains a resize handle. */
    resizable?: boolean;
}
```

In the JSX:

```tsx
<Popover
    ...
    matchAnchorWidth
    resizable={resizable}
    ...
>
```

No new state in Select — Popover handles everything.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/Popover/Popover.tsx` | Add `resizable` / `onResize` props; render resize handle; drag logic; `manualSize` state + ref; size middleware guard |
| `src/renderer/uikit/Popover/Popover.story.tsx` | Add `resizable` boolean control + long-content demo |
| `src/renderer/theme/icons.tsx` | Export `ResizeHandleIcon` for UIKit consumption (if not already exported in the existing module) |
| `src/renderer/uikit/Select/Select.tsx` | Pass-through `resizable` prop to inner `Popover` |
| `src/renderer/uikit/Select/Select.story.tsx` | Add `resizable` boolean control |

---

## Concerns / Open questions

### 1. Pointer capture vs Popover's outside-click listener

While the user is dragging, `pointermove` events stream to the popover root (via `setPointerCapture`). `mousedown` fires once at the start, on the resize handle. The handle is inside `Root` (data-type="popover"), so the outside-click listener's `target.closest('[data-type="popover"]')` will match — it does not close the popover. Verified mental model; no extra coordination needed.

### 2. Min-size lock

Legacy enforces `width > initialWidth && height > initialHeight` — strictly grow-only. We keep this. Min-size is whatever the popover opened at (anchor-matched or natural content size). Shrinking is **not** supported because:
- The popover can already auto-shrink to fit content when re-opened (manualSize discarded on close).
- Shrinking below initial size would make the resize handle harder to reach and the floating-ui auto-flip behavior less predictable.

If a user wants smaller, they close and re-open — popover starts at anchor / content width again.

### 3. Does the resize affect `flip` / repositioning?

No. The size middleware runs after `flip`. When the user drags, we set `manualSize` → `Root` width/height update → `autoUpdate` re-runs middleware → flip considers the new size. If the popover would now overflow the viewport, flip moves it. The handle position (bottom-right vs top-right) follows `actualPlacement`, so the handle stays at the corner that points away from the anchor.

### 4. Touch / stylus support

Pointer events handle all input types. We restrict mouse-button check to `event.buttons !== 1` only when `pointerType === "mouse"` — touch / stylus passes through. Same as legacy.

### 5. Reset behavior — discard or persist manual size?

**Discard on close.** This matches legacy and the "quick adjustment for one open session" UX. If a consumer wants persistence (e.g. user-preference for dropdown size), they can listen to `onResize` and pass a controlled `width` / `height` via inline style on a wrapper — but UIKit doesn't bake persistence in. Out of scope.

### 6. Accessibility

The drag interaction is mouse / touch only. The legacy popper doesn't have keyboard resize either. We don't add it here — keyboard users have the input full-width already via the keyboard navigation in ListBox; if a long label is truncated, they can use Tab/Arrow to move active row and rely on screen reader announcement. Future enhancement: support Ctrl+Plus / Ctrl+Minus shortcuts on the popover for keyboard resize, behind a follow-up flag.

---

## Acceptance criteria

- [ ] `<Popover resizable>` renders a corner handle at bottom-right.
- [ ] Dragging the handle grows width and height; the popover does not snap back.
- [ ] After a drag, `matchAnchorWidth` no longer re-applies (the manual width persists across `autoUpdate` ticks: scrolling, anchor resize, etc.).
- [ ] Closing and re-opening the popover discards `manualSize` — next open starts at the anchor-matched / natural width.
- [ ] When the popover is positioned above its anchor (`flip` activates), the handle moves to the top-right and drag direction inverts so dragging down still grows the popover.
- [ ] The popover cannot be shrunk below its initial open size (legacy parity).
- [ ] `data-resizable` and `data-resized` attributes appear on the popover root in the matching states.
- [ ] `<Select resizable>` works end-to-end: open dropdown, drag corner, list grows, long labels become readable.
- [ ] Outside-click on something not inside the popover still closes it (no regression from US-466).
- [ ] `npx tsc --noEmit` clean for the changed files.
- [ ] `npm run lint` clean for the changed files.
