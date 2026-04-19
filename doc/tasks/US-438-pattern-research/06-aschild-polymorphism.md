# Pattern 6: asChild Polymorphism

**Used by:** Radix UI (primary inventor), Ark UI

## What it is

A boolean `asChild` prop makes a component render its behavior and styles **onto its single child element** instead of its own DOM element. The component's props are merged onto the child.

```tsx
// Without asChild — renders <button> wrapping <a> (invalid HTML, two clickable elements)
<Button onClick={nav}>
    <a href="/home">Home</a>
</Button>

// With asChild — renders a single <a> with Button's styles and behavior
<Button asChild onClick={nav}>
    <a href="/home">Home</a>
</Button>
// Output: <a href="/home" class="..." onClick={nav}>Home</a>
```

The component effectively becomes a behavior/style decorator for whatever element the caller provides.

## How it works

Radix implements this via a `Slot` primitive that merges props onto the child:

```tsx
import { Slot } from "@radix-ui/react-slot";

function Button({ asChild, onClick, className, children, ...props }: ButtonProps) {
    const Comp = asChild ? Slot : "button";
    return <Comp onClick={onClick} className={className} {...props}>{children}</Comp>;
}
```

`Slot` clones the single child and merges all passed props onto it (event handlers are composed, not replaced).

## The problem it solves

Without `asChild`, making a component polymorphic requires an `as` prop:

```tsx
// The `as` prop approach — TypeScript headache
<Button as="a" href="/home">Link</Button>
<Button as={RouterLink} to="/home">Link</Button>
```

The TypeScript problem: the valid props depend on what `as` is. If `as="a"`, then `href` is valid. If `as="button"`, `href` is not. Typing this correctly requires complex generic types:

```tsx
type PolymorphicProps<E extends ElementType> = ComponentProps<E> & { as?: E };
function Button<E extends ElementType = "button">({ as, ...props }: PolymorphicProps<E>) { ... }
```

This is verbose, hard to infer, and breaks down with forwarded refs. `asChild` avoids all of this — the child element carries its own props; the parent only adds behavior.

## Value it brings

**Clean TypeScript** — no polymorphic generics. The child element types its own props; the parent types its own props. Both are simple interfaces.

**Composable behavior** — Button styles + `<a>` semantics. Tooltip trigger behavior + any element. Works with third-party components (React Router's `<Link>`) as naturally as with native elements.

**Correct HTML** — `asChild` prevents the double-element nesting problem. The output is a single element with correct semantics.

## Tradeoff

**Unusual pattern** — developers unfamiliar with Radix won't know what `asChild` does without documentation.

**Requires a `Slot` implementation** — either from `@radix-ui/react-slot` (a small package) or a custom one (~50 lines).

**Only one child allowed** — `asChild` requires exactly one React element child. Multiple children or a string child will throw.

**Not needed much in internal libraries** — `asChild` is most valuable in public component libraries where the caller doesn't control the element type. In Persephone, the element type is almost always known at the call site. The pattern rarely comes up.

## Persephone usage

Rare cases where it could help:
- A `Button` that sometimes renders as a link (e.g., in the link editor toolbar)
- A `ListItem` that is sometimes a drag handle and sometimes a clickable item

For most Persephone components, the element type is fixed and `asChild` provides little value over just writing two separate variants.

## Decision

❌ **Skip** — Persephone is an internal library and element types are fixed and known at every call site. The `asChild` pattern solves a problem (polymorphic elements without `as` prop generics) that rarely arises internally. Not adopted.
