# UIKit — Component Authoring Guide

This folder contains Persephone's new component library (`src/renderer/uikit/`).
Every component in this folder **must** follow these rules. Read this file before creating or modifying any component here.

---

## Folder structure

Each component lives in its own subfolder:

```
uikit/
  tokens.ts              ← design token constants (US-426)
  index.ts               ← public exports
  Button/
    Button.tsx
    index.ts
  Input/
    Input.tsx
    index.ts
  ...
```

No separate `.css` or `.scss` files — all styles use Emotion.

---

## Rule 1 — Data attributes for state (mandatory on every component)

Set `data-type` and `data-*` state attributes on the root element. Never express interactive state via CSS class names.

```tsx
<button
    data-type="button"
    data-disabled={disabled || undefined}
    data-variant={variant}
    data-size={size}
>
```

**`data-type` is required on every component.** Use kebab-case matching the component name.
It enables DOM inspection in DevTools and reliable querying by AI agent scripts:
```js
document.querySelectorAll('[data-type="button"][data-disabled]')
```

Pass `undefined` (not `false`) when a boolean attribute is inactive — `data-disabled="false"` still matches `[data-disabled]`.

### Standard state attributes

| Attribute | Values | When to use |
|-----------|--------|-------------|
| `data-type` | kebab-case name | **Always** — every component's root element |
| `data-disabled` | present / absent | component is disabled |
| `data-selected` | present / absent | item is selected |
| `data-active` | present / absent | item is focused / highlighted |
| `data-checked` | `"true"` / `"false"` / `"mixed"` | checkbox or toggle state |
| `data-state` | `"open"` / `"closed"` | expandable or floating element |
| `data-orientation` | `"horizontal"` / `"vertical"` | layout direction |
| `data-variant` | e.g. `"ghost"` / `"danger"` | visual variant |
| `data-size` | `"sm"` / `"md"` / `"lg"` | size variant |

### Style state via Emotion attribute selectors

```ts
const Root = styled.button({
    cursor: "pointer",
    "&[data-disabled]": {
        opacity: 0.4,
        pointerEvents: "none",
    },
    '&[data-variant="danger"]': {
        color: color.button.dangerFg,
    },
    '&[data-size="sm"]': {
        height: height.controlSm,
        fontSize: fontSize.sm,
    },
}, { label: "Button" });
```

---

## Rule 2 — Controlled components (no internal state for primary value)

Never use `useState` for the component's primary value. Models own all state.

```tsx
// WRONG
function Input({ defaultValue }: { defaultValue?: string }) {
    const [value, setValue] = useState(defaultValue ?? "");
    ...
}

// CORRECT
function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    ...
}
```

**Allowed** internal transient state:
- `isHovered`, `isFocused` — visual-only feedback
- `isOpen` — dropdown open/closed when not controlled externally

---

## Rule 3 — Trait-based data binding (list/collection components)

Applies to: **Select, MultiSelect, ListBox, Tree, SegmentedControl, and any component that takes a list of items.**

Accept `T[] | Traited<T[]>` for items/options props. Call `resolveTraited(items, KEY)` once at the top of the component — result is always the component's native array type.

```tsx
import { resolveTraited, Traited, TraitType } from "../../core/traits/traits";
import { TraitRegistry } from "../../core/traits/TraitRegistry";

export interface IOption {
    label: string;
    value: string;
    icon?: React.ReactNode;
}

const OPTION_KEY = TraitRegistry.register<TraitType<IOption>>("select-option");

export interface SelectProps<T = IOption> {
    items: T[] | Traited<T[]>;
    value: IOption | null;
    onChange: (v: IOption) => void;
}

export function Select<T = IOption>({ items, value, onChange }: SelectProps<T>) {
    const options = resolveTraited<IOption>(items, OPTION_KEY);
    // options is IOption[] — consume normally from here
}
```

**Rules:**
- Never add `getLabel`, `getValue`, `getIcon` accessor props — removed at point of conversion.
- The `TraitRegistry.register()` call lives in the component file — one key per component.
- Scalar-value components (`Input`, `Checkbox`, `TextField`) do not use this pattern — only list/collection props.

---

## Rule 4 — Roving tabindex (keyboard-navigable widgets only)

Applies to: **Toolbar, Tree, ListBox, SegmentedControl, Tab bar, and similar widgets.**

- Only one item has `tabIndex={0}` at a time (the active item); all others get `tabIndex={-1}`
- Arrow keys move focus within the widget; Tab / Shift+Tab exits it entirely
- Callers are unaware of this — it is internal behavior only

Do not apply to simple lists that are not keyboard-navigable widgets.

---

## Rule 5 — Focus trap (modal dialogs only)

Applies to: **all components that render a blocking modal overlay.**

When the modal opens:
- Move focus to the first focusable element inside
- Tab / Shift+Tab cycle only within the modal
- On close, return focus to the element that was focused before the modal opened

Does **not** apply to non-modal side panels or popovers that do not block background interaction.

---

## Rule 6 — UI Descriptor pattern (`ComponentSet`)

**Use when:** the list of child components is dynamic — built at runtime, driven by data, or constructed by a script that has no JSX.

The utility component `ComponentSet` accepts a `ComponentItem[]` descriptor array and renders the items as a flat React fragment (no wrapper element). Container components (`Toolbar`, `Menu`, `StatusBar`) stay as pure layout containers — they know nothing about descriptors.

```tsx
// Dynamic children via ComponentSet — Toolbar is unchanged
<Toolbar>
    <ComponentSet descriptors={items} />
</Toolbar>

// Static children via plain JSX — always prefer when the list is known
<Toolbar>
    <Button label="Run" onClick={handleRun} />
    <Separator />
    <Toggle label="Wrap" checked={wordWrap} onChange={setWordWrap} />
</Toolbar>
```

**`ComponentItem` — intersection type, not duplicated props:**

Each variant is `{ type: "x" } & XProps`. The existing component props are the descriptor shape; only a `type` discriminant is added.

```typescript
// uikit/ComponentSet/types.ts
export type ComponentItem =
    | { type: "button"    } & ButtonProps
    | { type: "toggle"    } & ToggleProps
    | { type: "select"    } & SelectProps
    | { type: "separator" }
    | { type: "text"      } & TextProps
```

After `item.type === "button"`, TypeScript gives you full `ButtonProps`. Adding a new variant produces a compile error in `ComponentSet` if the registry is not updated.

**`ComponentSet` implementation:**

```tsx
// uikit/ComponentSet/ComponentSet.tsx
import React from "react";
import { ComponentItem } from "./types";
import { Button }    from "../Button";
import { Toggle }    from "../Toggle";
import { Select }    from "../Select";
import { Separator } from "../Separator";
import { Text }      from "../Text";

const REGISTRY: Record<string, React.ComponentType<any>> = {
    button:    Button,
    toggle:    Toggle,
    select:    Select,
    separator: Separator,
    text:      Text,
};

export function ComponentSet({ descriptors }: { descriptors: ComponentItem[] }) {
    return (
        <>
            {descriptors.map((item, i) => {
                const { type, ...props } = item;
                const Component = REGISTRY[type];
                return Component ? <Component key={i} {...props} /> : null;
            })}
        </>
    );
}
```

**Rules:**
- `ComponentSet` renders a `<Fragment>` — never a wrapper `<div>`. The container's flex/grid layout applies directly to the rendered children.
- The registry lives in `ComponentSet/ComponentSet.tsx` — not in the container's file and not in a global file.
- New library components must be added to both `ComponentItem` and `REGISTRY` when they are implemented.
- Do not use `ComponentSet` for static, known UI. `<Button onClick={fn}>Run</Button>` is always cleaner than a descriptor object.

---

## Naming conventions

### Component names

Use the names from the US-438 naming table. Never use old names from `src/renderer/components/`.

| Old name | New name |
|----------|----------|
| `SwitchButtons` | `SegmentedControl` |
| `ComboSelect` | `Select` |
| `ListMultiselect` | `MultiSelect` |
| `List` | `ListBox` |
| `Popper` | `Popover` |
| `PopupMenu` | `Menu` |
| `TreeView` | `Tree` |
| `Chip` | `Tag` |
| `CircularProgress` | `Spinner` |
| `FlexSpace` | `Spacer` |
| `TextAreaField` | `Textarea` |
| `OverflowTooltipText` | `TruncatedText` |

### Prop names

Use predictable, self-documenting names. An AI agent reading the prop should understand it without opening the file.

| Concept | Use | Avoid |
|---------|-----|-------|
| Current value | `value` | `val`, `selectedValue`, `currentItem` |
| Change handler | `onChange` | `onValueChange`, `onSelect`, `handleChange` |
| Disabled state | `disabled` | `isDisabled`, `enabled` (inverted) |
| Loading state | `loading` | `isLoading`, `pending` |
| Open/closed | `open` | `isOpen`, `visible`, `show` |
| Open change handler | `onOpenChange` | `onToggle`, `setOpen` |
| List of options | `items` | `options`, `data`, `list` |
| Click handler | `onClick` | `onPress`, `handleClick` |
| Icon element | `icon` | `iconLeft`, `startIcon`, `leftAdornment` |
| Placeholder text | `placeholder` | `hint`, `hintText` |

### Boolean props

- Name as adjectives, not questions: `disabled` not `isDisabled`, `loading` not `isLoading`
- Default to `false` — caller opts in to the special state

---

## Styling rules

### Colors

Never use hex codes, `rgb()`, or named colors. Always import from `color.ts`:
```ts
import color from "../../theme/color";
// (adjust relative path based on component subfolder depth)
```

If a needed color is missing from `color.ts`, add it there and in all theme definitions under `src/renderer/theme/themes/`.

### Design tokens

Use constants from `uikit/tokens.ts` for all spacing, sizing, border-radius, and font-size values:
```ts
import { spacing, radius, fontSize, height, gap } from "../tokens";
```

Never hardcode pixel values that exist in the token scale.

### Emotion conventions

- One `styled.*` per logical DOM element
- All interactive states (`:hover`, `[data-*]`) go inside the same `styled` definition — no scattered overrides elsewhere
- Always include `{ label: 'ComponentName' }` as the second argument for DevTools readability

---

## Accessibility

- Always set `data-type` on the root element
- Use semantic HTML elements: `<button>` not `<div>` for clickable things, `<input>` for text input, etc.
- Forward `aria-*` and `role` props to the underlying element via `...rest`
- Never suppress the browser focus ring without providing an alternative focus indicator

---

## Component file template

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, spacing } from "../tokens";

// --- Types ---

export interface ButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: "default" | "danger" | "ghost";
    size?: "sm" | "md" | "lg";
    icon?: React.ReactNode;
}

// --- Styled ---

const Root = styled.button({
    display: "inline-flex",
    alignItems: "center",
    gap: spacing.sm,
    cursor: "pointer",
    border: "none",
    background: "transparent",

    "&[data-disabled]": {
        opacity: 0.4,
        pointerEvents: "none",
    },
    '&[data-variant="danger"]': {
        color: color.button.dangerFg,
    },
    '&[data-size="sm"]': {
        height: height.controlSm,
        fontSize: fontSize.sm,
        padding: `0 ${spacing.sm}px`,
    },
    '&[data-size="md"]': {
        height: height.controlMd,
        fontSize: fontSize.base,
        padding: `0 ${spacing.md}px`,
    },
}, { label: "Button" });

// --- Component ---

export function Button({
    label,
    onClick,
    disabled,
    variant = "default",
    size = "md",
    icon,
}: ButtonProps) {
    return (
        <Root
            data-type="button"
            data-disabled={disabled || undefined}
            data-variant={variant}
            data-size={size}
            onClick={disabled ? undefined : onClick}
        >
            {icon}
            {label}
        </Root>
    );
}
```
