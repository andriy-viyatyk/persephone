# Pattern 5: Controlled-by-Default (No Uncontrolled Mode)

**Used by:** (internal app libraries) — public libraries like Radix do the opposite

## What it is

A component always requires its state to be provided and managed externally via `value` + `onChange` props. There is no `defaultValue` prop, no internal `useState` that the component manages for you.

```tsx
// Public library — supports both modes
<Select value={value} onChange={setValue} />     // controlled (external state)
<Select defaultValue="ts" />                     // uncontrolled (internal useState)

// Persephone library — controlled only
<Select value={model.language} onChange={model.setLanguage} />
```

## Why public libraries need uncontrolled mode

In a general-purpose library (shadcn/ui, Radix), the caller might not have a state management solution at all. `defaultValue` lets them use the component with zero boilerplate:

```tsx
<Input defaultValue="hello" />  // just works, internal state
```

Without `defaultValue`, every use of every component requires external state — that is too heavy for casual use.

## Why Persephone doesn't need uncontrolled mode

Persephone's components are always used within editor views that already have a model. The model owns all state. There is no "casual use" without a model:

```tsx
// Every real usage already has a model
<Select value={model.state.use(s => s.language)} onChange={model.setLanguage} />
```

If the model isn't set up, the component shouldn't render at all. Adding `defaultValue` / internal state would create a second source of truth that fights the model — exactly the kind of bug this pattern prevents.

## What "controlled-only" means in practice

1. **No `defaultValue` props** on any component
2. **No internal `useState`** for the component's primary value
3. **`value` is always required** (or has a well-defined empty/null state)
4. **If `value` is undefined**, the component renders its empty/placeholder state — it doesn't manage state to fill the gap

```tsx
// Clear rule: undefined value = empty state
<Select value={undefined} onChange={...} />  // renders "Select..." placeholder
<Select value="ts" onChange={...} />         // renders "TypeScript"
```

## Exceptions

Some components have **intrinsic transient state** that belongs inside the component and is not the caller's concern:

- **Dropdown open/closed** — the open state of a ComboBox dropdown is internal transient state, not application state. The caller doesn't need to control this unless they specifically want to.
- **Tooltip visible/hidden** — hover state is internal.
- **Hover / focus / active** — always internal.

The rule applies only to the component's **primary value** (the data the component is displaying or editing).

## Tradeoff

More boilerplate at each call site — you always need to provide `value` and `onChange`. But in Persephone every call site already has a model that provides these, so the boilerplate is already there.

## Persephone usage

This is a **convention decision**, not a code change. The impact is on how new components are written and reviewed:

- When adding a new form component: do not add `defaultValue`, do not add internal `useState` for the primary value
- When reviewing a PR: flag any component that manages its own primary value internally

## Decision

✅ **Already our practice** — Persephone uses model classes to own all state; components are always controlled. No `defaultValue`, no internal `useState` for primary values. This is not a new pattern to adopt — it is a confirmation that the existing approach is correct. Enforce as a convention when authoring new components (documented in the new components CLAUDE.md).
