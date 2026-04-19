# Pattern 4: Component Variant Recipe

**Used by:** shadcn/ui (via CVA), Panda CSS, Stitches, Vanilla Extract

## What it is

All visual variants of a component (size, intent/color, shape) are defined once in a **structured recipe object** rather than scattered across conditional expressions. TypeScript enforces valid variant combinations at the call site.

CVA (class-variance-authority) is the popular library for class-name-based systems. For Persephone, which uses Emotion (CSS-in-JS), the equivalent is a **variant function** that returns CSS objects:

```ts
// variant() is a small helper we define once
function variant<V extends Record<string, Record<string, object>>>(config: {
    base: object;
    variants: V;
    defaultVariants?: { [K in keyof V]?: keyof V[K] };
}) {
    return (selected: { [K in keyof V]?: keyof V[K] }) => {
        const result = { ...config.base };
        for (const key of Object.keys(config.variants) as (keyof V)[]) {
            const value = selected[key] ?? config.defaultVariants?.[key];
            if (value) Object.assign(result, config.variants[key][value as string]);
        }
        return result;
    };
}
```

Then each component defines its recipe:

```ts
// Button variants — all in one place
const buttonRecipe = variant({
    base: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 3,
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        border: "none",
        transition: "opacity 0.1s, transform 0.1s",
        "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
    },
    variants: {
        size: {
            sm: { height: 24, padding: "0 6px", fontSize: 11 },
            md: { height: 26, padding: "0 8px", fontSize: 12 },
            lg: { height: 32, padding: "0 12px", fontSize: 13 },
        },
        intent: {
            default: { background: color.button.default, color: color.text.default },
            ghost:   { background: "transparent",        color: color.text.default },
            primary: { background: color.accent.default, color: color.text.onAccent },
            danger:  { background: color.status.error,   color: color.text.onAccent },
        },
    },
    defaultVariants: { size: "md", intent: "default" },
});

// Component uses the recipe
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    size?: "sm" | "md" | "lg";
    intent?: "default" | "ghost" | "primary" | "danger";
}

const ButtonRoot = styled.button<ButtonProps>(
    ({ size, intent }) => buttonRecipe({ size, intent })
);
```

Call site:
```tsx
<Button size="sm" intent="ghost">Cancel</Button>
<Button intent="primary">Save</Button>
<Button intent="danger">Delete</Button>
```

TypeScript catches `intent="invalid"` immediately. No valid combination is missing because all variants are enumerated in the recipe.

## Value it brings

**All variants visible in one place** — open `Button.tsx`, see all sizes and all intents. No hunting through conditional expressions or multiple styled variants.

**Consistent across components** — once the `size` and `intent` vocabulary is established, every component uses the same keys. `Button`, `Badge`, `Tag`, `Input` all accept `size="sm"|"md"|"lg"` with the same meaning.

**Adding a variant is one edit** — add a new intent to the recipe object; TypeScript immediately flags call sites that need to handle the new value.

**Design tokens flow directly in** — the recipe uses `color.*` and spacing constants from design tokens. Changing a token updates every variant that uses it.

**Default variants** — specify which size/intent to use when props are omitted. No need to repeat defaults in each component's implementation.

## Tradeoff

Slightly more structure upfront — you define the recipe before writing the component. For a component with only one variant (e.g., always medium, always default intent), a recipe is overkill; just write the styles directly.

The `variant()` helper itself is ~20 lines and needs to be written once and placed in the component utilities.

## Persephone usage

Components that have implicit or scattered variants today:

| Component | Current | Recipe benefit |
|-----------|---------|----------------|
| `Button` | Multiple styled variants per file | Single recipe: size × intent |
| `SwitchButtons` | Custom segment sizing | size recipe |
| `Tag` / `Badge` | Inline color conditionals | intent recipe for color variants |
| `Input` | No standardized sizing | size recipe |
| Toolbar items | Ad-hoc sizing | sm size variant |

The recipe also directly supports the **design token scales** from US-426: the `size` variants map directly to `control-sm: 24px`, `control-md: 26px`, `control-lg: 32px` from the element height scale.

## Decision

❌ **Skip** — Design token constants (US-426) already define the variant scales (sizes, spacing, radius). For an internal library, using those constants directly in Emotion styled components is simpler than a structured recipe object. A recipe helper makes most sense for public libraries with many external consumers. Not adopted.
