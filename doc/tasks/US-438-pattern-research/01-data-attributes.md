# Pattern 1: Data Attributes for Interactive State

**Used by:** Radix UI (exclusively), Headless UI, React Aria

## What it is

Use `data-*` HTML attributes to express a component's interactive state on the DOM element, instead of applying CSS class names like `"button--disabled"` or `"item--selected"`.

```tsx
// Instead of this
<button className={clsx("btn", { "btn--disabled": disabled, "btn--pressed": pressed })}>

// Do this
<button
    data-disabled={disabled || undefined}
    data-pressed={pressed || undefined}
    data-variant={variant}
>
```

Setting to `undefined` when false means the attribute is absent entirely — `[data-disabled]` only matches when the attribute is present, which is exactly what you want.

Emotion styled components then target these attributes:

```ts
const Button = styled.button({
    cursor: "pointer",
    "&[data-disabled]": {
        opacity: 0.4,
        pointerEvents: "none",
        cursor: "not-allowed",
    },
    "&[data-pressed]": {
        transform: "scale(0.97)",
    },
    '&[data-variant="ghost"]': {
        background: "transparent",
    },
});
```

## Common data attributes across all interactive components

| Attribute | Values | Meaning |
|-----------|--------|---------|
| `data-type` | component name | identifies the component type in DOM |
| `data-disabled` | present/absent | component is disabled |
| `data-selected` | present/absent | item is selected |
| `data-active` | present/absent | item is focused/highlighted |
| `data-checked` | `"true"` / `"false"` / `"mixed"` | checkbox/toggle state |
| `data-state` | `"open"` / `"closed"` | expandable is open |
| `data-orientation` | `"horizontal"` / `"vertical"` | layout direction |
| `data-variant` | e.g. `"ghost"` / `"danger"` | visual variant |

### `data-type` — component identity in the DOM

Every Persephone library component sets a `data-type` attribute on its root element with a stable, lowercase kebab-case identifier:

```tsx
// Button
<button data-type="button" data-disabled={disabled || undefined} ...>

// ListItem
<div data-type="list-item" data-selected={selected || undefined} ...>

// ComboBox
<div data-type="combo-box" data-state={open ? "open" : "closed"} ...>

// Tab
<div data-type="tab" data-active={active || undefined} ...>
```

This serves two purposes:

**Developer inspection** — in DevTools the component hierarchy is immediately readable. You see `data-type="combo-box"` in the Elements panel without decoding className strings.

**AI agent scripting** — scripts have full access to `document` in the renderer process. An AI agent helping investigate a UI issue can:
```javascript
// Find all disabled buttons
document.querySelectorAll('[data-type="button"][data-disabled]')

// Find all open dropdowns
document.querySelectorAll('[data-type="combo-box"][data-state="open"]')

// Find all selected list items
document.querySelectorAll('[data-type="list-item"][data-selected]')
```

This makes programmatic UI inspection reliable. Without `data-type`, the agent would have to guess CSS class names or element structure, which breaks whenever the component is refactored.

## Value it brings

**DevTools visibility** — in the Elements panel you immediately see the state of any component (`data-disabled`, `data-state="open"`) without reading className strings.

**No className juggling** — no `clsx("item", { "item--selected": isSelected, "item--active": isActive })`. The component just sets attributes.

**Styles co-locate with structure** — the styled component definition covers both the base style and all interactive states in one place. No separate `.scss` or utility class overrides.

**External styling is easier** — if a user of the component wants to override the disabled style, they write `[data-disabled] { ... }` which is unambiguous.

**Works with CSS transitions** — `[data-state="open"]` / `[data-state="closed"]` pair naturally with CSS transitions on the same element.

## Tradeoff

Slightly less familiar than className for developers used to BEM/utility-class patterns. Requires discipline to use `undefined` (not `false`) to remove absent attributes — otherwise `data-disabled="false"` matches `[data-disabled]`.

## Persephone usage

Currently Persephone uses both `clsx` + className strings (e.g., `clsx("file-page")` in TextEditorView) and inline conditional styles. Migrating to data attributes would affect:

- `Button` — `disabled`, pressed/active states
- `ListItem` / tree nodes — `selected`, `active`, `disabled`
- `Tab` — `active`, `disabled`
- Any collapsible element — `data-state="open|closed"`
- `SwitchButtons` — `data-checked`

## Decision

✅ **Adopt** — Use data attributes for all interactive state across every new library component. Every component also sets `data-type` on its root element for DOM identity.

Rationale:
- Aligns with Radix/MUI practice — well-proven pattern in production libraries
- `data-type` adds value beyond styling: enables reliable DOM inspection by DevTools and AI agent scripts
- No className juggling — styled component definitions cover all states in one place
- Replaces the existing `clsx` pattern at point of conversion; no need to run both approaches in parallel
