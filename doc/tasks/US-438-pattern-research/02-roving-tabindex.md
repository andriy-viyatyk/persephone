# Pattern 2: Roving Tabindex for Keyboard Navigation

**Used by:** React Aria, Radix UI, all ARIA-compliant component libraries

## What it is

In a group of focusable elements (toolbar, list, tree, tab bar), only **one element has `tabIndex={0}`** at a time. All others have `tabIndex={-1}`. Arrow keys move the "active" index within the group; Tab leaves the group entirely.

```
[Tab] → enters the group at the last active item
[↑] [↓] or [←] [→] → move within the group
[Tab] → exits the group, moves to the next focusable on the page
```

This is the correct ARIA keyboard pattern for composite widgets (toolbars, listboxes, trees, grids, tab lists).

## How it works

```tsx
function useRovingTabIndex(count: number) {
    const [activeIndex, setActiveIndex] = useState(0);

    const getTabIndex = (index: number) => (index === activeIndex ? 0 : -1);

    const handleKeyDown = (e: KeyboardEvent, index: number) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            e.preventDefault();
            const next = (index + 1) % count;
            setActiveIndex(next);
            // focus the element at `next` index
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            const prev = (index - 1 + count) % count;
            setActiveIndex(prev);
        }
    };

    return { getTabIndex, handleKeyDown, activeIndex, setActiveIndex };
}

// Usage in a toolbar
function Toolbar({ items }: { items: ToolbarItem[] }) {
    const { getTabIndex, handleKeyDown } = useRovingTabIndex(items.length);

    return (
        <div role="toolbar">
            {items.map((item, i) => (
                <button
                    key={item.id}
                    tabIndex={getTabIndex(i)}
                    onKeyDown={(e) => handleKeyDown(e, i)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
```

## Why this matters

Without roving tabindex, a toolbar with 10 buttons requires 10 Tab presses to traverse. That is incorrect behavior by ARIA spec and frustrating for keyboard users. With roving tabindex, the toolbar is a **single tab stop** — the user presses Tab once to reach it, arrow keys to navigate within it, Tab again to leave.

The same principle applies to:
- **List boxes** — arrow keys select items, Tab exits
- **Tree views** — arrow keys expand/collapse and navigate, Tab exits
- **Tab bars** — arrow keys switch tabs, Tab moves focus to the tab panel content
- **Grid rows** — arrow keys navigate cells

## Persephone usage

Components that currently have incorrect or missing keyboard behavior:

| Component | Location | Issue |
|-----------|----------|-------|
| Toolbar buttons | `TextToolbar.tsx` | each button is its own tab stop |
| Tree nodes | `TreeView` | arrow key navigation likely missing |
| Tab bar | page tabs | arrow key switching between tabs |
| ComboBox options | dropdown list | arrow key selection |
| SwitchButtons | `SwitchButtons.tsx` | segment group should be one tab stop |
| Grid rows | `AVGrid.tsx` | arrow key cell navigation |

A shared `useRovingTabIndex` hook would fix all of these in one place.

## Wrapping vs clamping

Two behaviors at the ends of the group:
- **Wrap** — after the last item, next goes to first (most toolbars, tab lists)
- **Clamp** — stop at the first/last item (most lists, trees)

The hook should accept a `wrap` option.

## Tradeoff

Requires tracking `activeIndex` in state and imperatively calling `.focus()` on the newly active element (via a ref array). More complex than simply putting `tabIndex={0}` on everything — but the keyboard experience improvement is significant and it is the correct behavior per ARIA spec.

## Decision

✅ **Adopt (internal)** — Implement as an internal keyboard behavior inside specific keyboard-navigable widgets: Toolbar, TreeView, List, Tab bar, SwitchButtons, AVGrid. Not a public API pattern — callers are unaware of it. The `useRovingTabIndex` hook lives inside each component and is not exported as a general utility.
