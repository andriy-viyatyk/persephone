# Pattern 7: Focus Trap

**Used by:** Radix UI (Dialog), Headless UI (Dialog), React Aria (Modal), focus-trap-react library

## What it is

When a modal dialog is open, keyboard Tab and Shift+Tab cycle focus **only within the modal**. Focus cannot reach elements behind the modal. When the modal closes, focus returns to the element that originally opened it.

This is required behavior by ARIA spec for all modal dialogs.

```
Before modal opens:  [Button A] [Button B] [Open Dialog btn*] [Button C]
                                                      ^cursor here

Modal opens:         [Dialog: [Input] [Cancel btn] [Save btn*]]
                                                          ^focus moves here

Tab inside modal:    cycles: Input → Cancel → Save → Input → ...
Shift+Tab:           cycles backwards

Escape / close:      focus returns to [Open Dialog btn]
```

## How it works

A `FocusTrap` component:
1. On mount: finds all focusable elements within itself, moves focus to the first (or a designated element)
2. Intercepts Tab / Shift+Tab: if focus would leave the trap, redirect it to the other end
3. On unmount: restores focus to the element that was focused before the trap activated

```tsx
function FocusTrap({ active, children }: { active: boolean; children: ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<Element | null>(null);

    useEffect(() => {
        if (!active) return;

        // Remember who had focus
        previousFocusRef.current = document.activeElement;

        // Focus first focusable element in the trap
        const focusable = getFocusableElements(containerRef.current!);
        focusable[0]?.focus();

        // Intercept Tab
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const elements = getFocusableElements(containerRef.current!);
            const first = elements[0];
            const last = elements[elements.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            // Restore focus on unmount
            (previousFocusRef.current as HTMLElement)?.focus();
        };
    }, [active]);

    return <div ref={containerRef}>{children}</div>;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), ' +
            'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    ) as HTMLElement[];
}
```

Usage in a Dialog:

```tsx
function Dialog({ open, onClose, children }: DialogProps) {
    return open ? (
        <Overlay>
            <FocusTrap active={open}>
                <DialogPanel>
                    {children}
                    <button onClick={onClose}>Close</button>
                </DialogPanel>
            </FocusTrap>
        </Overlay>
    ) : null;
}
```

## Value it brings

**Correct modal behavior** — without a focus trap, Tab in an open dialog reaches elements behind it (the editor, other toolbars). The user can accidentally interact with background content. This is a significant accessibility and usability issue.

**Focus restoration** — when a dialog closes, focus snaps back to where the user was. Without this, the user is disoriented (focus is lost, usually jumps to `<body>`).

**Keyboard-only users** — for users who navigate entirely with the keyboard, a focus trap is essential. Without it, dialogs are effectively unusable.

**One implementation, all dialogs** — a single `FocusTrap` component fixes keyboard behavior for every modal in the app.

## Persephone current state

Persephone has several modal dialogs (Open URL, Save, Confirm, settings panels). It is unlikely any of them currently implement focus trapping. Tab probably escapes into background content.

Files likely affected:
- `src/renderer/ui/dialogs/` — all dialog components
- Any component that renders an overlay/modal panel

## Third-party option

Rather than implementing `FocusTrap` from scratch, `focus-trap-react` is a well-tested 3KB library that handles all edge cases (iframes, shadow DOM, dynamically added focusable elements, initial focus element selection). Worth considering over a custom implementation.

## Tradeoff

**Nested dialogs** — if a dialog opens another dialog (e.g., a confirm inside a settings dialog), you need trap stacking: the inner trap is active, the outer trap is paused. This is handled automatically by `focus-trap-react` but requires care in a custom implementation.

**Non-modal panels** — focus trap only applies to true modals (overlays that block interaction). Side panels that don't block the rest of the UI should NOT trap focus.

## Decision

✅ **Adopt (internal)** — Implement inside every modal overlay component: dialogs, confirm panels, settings panels. Not applied to non-modal side panels or popovers that don't block background interaction. Implemented as an internal `FocusTrap` wrapper inside each modal component — not a general utility exposed to callers.
