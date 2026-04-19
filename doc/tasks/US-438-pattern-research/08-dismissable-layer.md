# Pattern 8: Dismissable Layer / Click-Outside

**Used by:** Radix UI (DismissableLayer), Floating UI, Headless UI

## What it is

Floating elements (dropdowns, popovers, tooltips, context menus) close when the user clicks outside them or presses Escape. When multiple floating elements are stacked (e.g., a popover inside a dialog), only the **topmost layer** closes on outside click — not every layer at once.

```
No stack awareness (naive):
  User clicks outside popover inside dialog
  → Both popover AND dialog close  ← wrong

With stack/layer awareness:
  User clicks outside popover inside dialog
  → Only popover closes            ← correct
  User then clicks outside dialog
  → Dialog closes
```

## The naive approach and its problem

The simplest click-outside implementation attaches a `mousedown` listener to `document`:

```tsx
useEffect(() => {
    const handler = (e: MouseEvent) => {
        if (!ref.current?.contains(e.target as Node)) {
            onClose();
        }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
}, [onClose]);
```

This works for a single floating element but breaks when nested:
- Both the popover and the dialog register the same listener
- A click outside the popover (but inside the dialog) triggers both handlers
- The popover closes correctly, but so does the dialog — which shouldn't

## The layer model

Radix models this as a **stack of dismissable layers**. Each floating element registers itself as a layer when it mounts and unregisters on unmount. The stack tracks which layer is on top. Only the topmost layer responds to outside clicks.

```tsx
// Simplified layer stack concept
const layerStack: Set<symbol> = new Set();

function DismissableLayer({ onDismiss, children }: DismissableLayerProps) {
    const id = useRef(Symbol());

    useEffect(() => {
        layerStack.add(id.current);
        return () => layerStack.delete(id.current);
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            // Only the topmost layer responds
            const layers = Array.from(layerStack);
            if (layers[layers.length - 1] !== id.current) return;

            if (!containerRef.current?.contains(e.target as Node)) {
                onDismiss("click-outside");
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onDismiss]);

    return <div ref={containerRef}>{children}</div>;
}
```

Escape key handling works the same way — only the topmost layer responds to Escape.

## Usage

```tsx
// ComboBox dropdown
function ComboBoxDropdown({ onClose }: { onClose: () => void }) {
    return (
        <DismissableLayer onDismiss={onClose}>
            <OptionList>...</OptionList>
        </DismissableLayer>
    );
}

// Context menu
function ContextMenu({ onClose }: { onClose: () => void }) {
    return (
        <DismissableLayer onDismiss={onClose}>
            <MenuContent>...</MenuContent>
        </DismissableLayer>
    );
}
```

The layer stack handles nesting automatically — no caller code needed.

## Value it brings

**Correct nested behavior** — the most visible user-facing benefit. Opening a dropdown inside a dialog and clicking elsewhere should close only the dropdown. Without layer awareness this is broken.

**Centralised Escape handling** — one place handles all floating element dismissal. No duplication of `onKeyDown` Escape handlers across every floating component.

**Single implementation** — one `DismissableLayer` component fixes click-outside for every floating element in the app.

## Persephone current state

Persephone has context menus, tooltips, and ComboBox dropdowns. Click-outside is likely implemented ad-hoc per component (or missing), and nested cases are probably broken. A `DismissableLayer` would unify all of them.

Components that need this:
- ComboBox / Select dropdown
- Context menus
- Tooltips (on mouse leave rather than click-outside, but Escape still applies)
- Any custom popover or floating panel

## Third-party option

**Floating UI** (`@floating-ui/react`) is the standard library for floating element positioning AND includes dismissal logic. It handles click-outside, Escape, and focus-out dismissal correctly, including nested cases. If Persephone adopts Floating UI for positioning (which it would need for dropdowns anyway), the dismissal behavior comes for free.

Floating UI is used by shadcn/ui, Radix UI, and most modern component libraries as the positioning engine.

## Tradeoff

**Layer management complexity** — implementing the stack from scratch has edge cases (portals, iframes, conditional rendering). Using Floating UI's built-in hooks sidesteps all of this.

**Pointer events vs mouse events** — `mousedown` is the correct event for click-outside (fires before `click`, allows cancellation), but touch events need separate handling on mobile. Not relevant for Persephone (Electron desktop only).

## Decision

🔀 **Skip (covered by Floating UI)** — Persephone already has `@floating-ui/react` as a dependency, used in `Popper.tsx`, `showPopupMenu.tsx`, `WithPopupMenu.tsx`, and others. Floating UI handles click-outside dismissal and Escape handling correctly, including nested cases, as part of its built-in interaction hooks. No custom `DismissableLayer` implementation needed — use Floating UI's `useClick`, `useDismiss`, and `useInteractions` hooks in floating components instead.
