# EPIC-025: Unified Component Library and Storybook Editor

## Status

**Status:** Active
**Created:** 2026-04-17

## Overview

This epic builds a unified, well-designed component library for Persephone through a **consolidation-first approach** — working with the existing VSCode-inspired design rather than replacing it. Attempts to create a new visual language via HTML mockups showed that the current Persephone design is solid and worth keeping; the bigger value is in making it consistent and well-structured.

The approach has two interleaved tracks:

1. **Consolidation** — unify scattered inline styled definitions into shared primitives, fix minor inconsistencies, and improve consistency across the app. The act of consolidating will itself make the design cleaner and more coherent.
2. **Pattern research** — before writing library code, research which component patterns fit Persephone's use cases. Study how existing components work, identify repeated patterns, and define a clear component API convention. Implementation follows only after patterns are settled.

The HTML prototype work (US-437) is closed as a primary deliverable. Design decisions are now driven by the existing app rather than standalone mockups.

## Goals

- **Consolidation** — unify scattered inline `styled.div` definitions across 140+ locations into shared layout primitives and design tokens; improve consistency as a side effect of consolidating
- **Pattern research first** — identify repeated patterns in existing components, define a clear and Persephone-appropriate component API convention, and settle those decisions before writing library code
- **Consistent styling** across the entire application through shared design tokens and layout primitives
- **Better code reuse** — eliminate redundancy without breaking the existing design language
- **Built-in Storybook editor** — interactive component browser with property editor for testing and documentation
- **Script-accessible UI** — scripts can build custom editor UIs using the component library

## Dependencies

- **EPIC-026** (Trait System) — **complete**. All tasks done: core primitives (US-428), drag-and-drop infrastructure and migration (US-444, US-447, US-448, US-449), documentation (US-446).
  - `TraitSet`, `Traited<V>`, `traited()`, `resolveTraited()`, `TraitRegistry`, and all well-known trait keys are available.
  - This epic has no remaining blockers from EPIC-026.

## Design Decisions

### 1. Design System Foundations

Based on codebase analysis, the following scales standardize the most frequently used values:

**Spacing scale** (covers 95%+ of current usage):
```
xs: 2px    sm: 4px    md: 8px    lg: 12px    xl: 16px    xxl: 24px    xxxl: 32px
```

**Border radius scale:**
```
xs: 2px    sm: 3px    md: 4px    lg: 6px    xl: 8px    full: 50%
```

**Element height scale:**
```
icon-sm: 12px    icon-md: 16px    icon-lg: 20px
control-sm: 24px    control-md: 26px    control-lg: 32px
```

**Font size scale:**
```
xs: 11px    sm: 12px    md: 13px    base: 14px    lg: 16px    xl: 20px    xxl: 24px
```

**Gap scale:**
```
xs: 2px    sm: 4px    md: 6px    lg: 8px    xl: 12px    xxl: 16px
```

Colors are already well-organized in `color.ts` via CSS custom properties — no changes needed to the color system.

### 2. Layout Primitives

New components to replace 100+ inline styled definitions:

- **Flex** — configurable flex container (direction, gap, align, justify, wrap)
- **HStack / VStack** — horizontal/vertical flex shortcuts with default gap
- **Panel** — bordered container with standard padding, background, and border-radius
- **Card** — elevated panel with shadow
- **Spacer** — flexible space filler (replaces `FlexSpace` with more options)

These compose well together and use design tokens for all spacing/sizing values.

### 3. Storybook Editor

A new built-in Persephone editor type (registered like grid, markdown, mermaid) that provides:

- **Component browser** — tree view of all available components in the left panel
- **Live preview** — center area rendering the selected component with current props
- **Property editor** — panel where you toggle/edit props and see changes in real-time
- **Script tab** — write a script that builds a UI from components, verify the result
- **Test scripts** — scripts that assert component behavior for automated testing

The storybook editor dogfoods the component library — building it validates that the components compose correctly.

### 4. Script UI API

Expose the consolidated component library through the scripting engine:
- Scripts use the same components as the app
- A script can build a custom editor UI from layout primitives and form elements
- Trait system (from EPIC-026) available to scripts for data binding

### 5. UI Descriptor Pattern — ComponentSet

A **UI descriptor** is a plain object (JSON-like, may carry function references) that describes a component without instantiating it. Rather than embedding descriptor logic inside each container component, a single utility component — **`ComponentSet`** — handles descriptor-to-component resolution and renders the result as a flat React fragment (no wrapper element).

```tsx
<Toolbar>
    <ComponentSet descriptors={items} />
</Toolbar>
```

`ComponentSet` returns a `<Fragment>` — no extra DOM node — so the container's layout (flex, grid) applies directly to the rendered children, exactly as if the components were written as JSX inline.

**Why this shape:**
- Containers (`Toolbar`, `Menu`, `StatusBar`) remain **pure layout components** — they know nothing about descriptors.
- `ComponentSet` is **universal** — one component, one registry, works inside any container.
- Scripts have no JSX. Passing a descriptor array is the only practical way for scripts to build UI. `ComponentSet` makes this possible everywhere.
- Cross-boundary contributions (a child declaring toolbar items without knowing the toolbar's internals) use the same mechanism — pass a descriptor array, render via `ComponentSet`.

**`ComponentItem` — discriminated union using intersections:**

Each variant is `{ type: "x" } & XProps`. No duplication — the existing component props are the descriptor shape, extended with a type discriminant:

```typescript
type ComponentItem =
    | { type: "button"    } & ButtonProps
    | { type: "toggle"    } & ToggleProps
    | { type: "select"    } & SelectProps
    | { type: "separator" }
    | { type: "text"      } & TextProps
```

TypeScript narrows correctly — after `item.type === "button"`, the type is `ButtonProps`. Adding a new variant produces a compile error in `ComponentSet` if the registry is not updated.

**`ComponentSet` implementation sketch:**

```tsx
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

**When to use / when not to:**
- **Use** — when the component list is dynamic (built at runtime, from data, or from a script). The array can be built conditionally, mutated, sorted, or serialized.
- **Do not use** — for static, known UI where JSX is available. `<Button onClick={fn}>Run</Button>` is always cleaner than a descriptor.

**Toolbar contribution — concrete re-engineering:**

Current approach: `TextEditorView` passes DOM refs (`setEditorToolbarRefFirst/Last`) to child components that portal their controls into those slots. This is fragile and couples DOM lifecycle to render order.

Proposed approach: child components declare a `ComponentItem[]` array (via prop or context); the parent renders `<ComponentSet descriptors={items} />` inside `<Toolbar>`. Ordering is explicit. No DOM hacks. Items can be merged, filtered, or sorted before rendering.

### 6. Data Attributes for Interactive State and Component Identity

Every new library component uses `data-*` attributes for interactive state rather than CSS class names.

**State attributes** (present/absent boolean flags, string values):
```tsx
<button
    data-type="button"
    data-disabled={disabled || undefined}
    data-variant={variant}
>
```

Setting `undefined` (not `false`) removes the attribute entirely — `[data-disabled]` matches only when the component is actually disabled.

Emotion styled components target these selectors:
```ts
const Button = styled.button({
    "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
    '&[data-variant="ghost"]': { background: "transparent" },
});
```

**`data-type` — component identity attribute:**
Every library component sets `data-type` on its root element with a stable kebab-case name (e.g. `"button"`, `"list-item"`, `"combo-box"`, `"tab"`). This serves two purposes:

- **DevTools inspection** — the component hierarchy is immediately readable in the Elements panel without decoding className strings.
- **AI agent scripting** — scripts have full `document` access in the renderer. An AI agent investigating a UI issue can query `document.querySelectorAll('[data-type="button"][data-disabled]')` reliably, without guessing CSS class names that may change during refactoring.

**Convention:** Replace `clsx` + className at point of conversion. No need to run both approaches in parallel on the same component.

### 7. Roving Tabindex for Keyboard Navigation

Keyboard-navigable widgets (toolbars, lists, trees, tab bars, button groups) implement **roving tabindex** as an internal behavior:

- The widget has a single `tabIndex={0}` entry point — only one item is focusable at a time.
- Arrow keys move focus within the widget; the active item gets `tabIndex={0}`, all others get `tabIndex={-1}`.
- Tab / Shift+Tab exits the widget entirely.

This is the correct behavior per ARIA spec for composite widgets. Without it, Tab visits every item individually — awkward in a toolbar with 10 buttons.

**Scope:** This is a pure internal implementation detail. Component consumers are unaware of it — they just Tab into the widget and use arrow keys. A `useRovingTabIndex` hook is implemented inside each applicable component and is not exported as a general utility.

**Components that apply this pattern:**
- `Toolbar` / `TextToolbar` — left/right arrows
- `TreeView` — up/down arrows, right/left for expand/collapse
- `List` / `ListBox` — up/down arrows
- `Tab bar` — left/right arrows
- `SwitchButtons` — left/right arrows
- `AVGrid` header row — left/right arrows (rows already have their own focus model)

**Wrap vs clamp:** Toolbar and tab bar wrap (after last item → first); List and Tree clamp (stop at ends).

### 8. Focus Trap for Modal Dialogs

Modal overlay components implement **focus trapping** as an internal behavior:

- When a modal opens, focus moves to the first focusable element inside it.
- Tab / Shift+Tab cycle focus only within the modal — focus cannot reach elements behind it.
- When the modal closes, focus returns to the element that had focus before the modal opened.

This is required behavior per ARIA spec for all modal dialogs. Without it, Tab escapes into background content (editor, toolbars), which is a significant usability and accessibility issue.

**Scope:** Internal to each modal component. Callers just render the dialog — focus behavior is automatic. A `FocusTrap` wrapper is used inside the modal, not exported as a general utility.

**Applies to:** All components in `src/renderer/ui/dialogs/` and any component that renders a blocking overlay. Does **not** apply to non-modal side panels that don't block background interaction.

### 9. Trait-based Data Binding for List and Data Components

Any component that accepts a list of data items (`Select`, `MultiSelect`, `ListBox`, `Tree`, `SegmentedControl`, etc.) accepts `T[] | Traited<T[]>` for its items/options prop and calls `resolveTraited(items, KEY)` once at the top of the component to resolve the data into the component's native shape.

```tsx
import { resolveTraited, Traited, TraitType } from "../../core/traits/traits";
import { TraitRegistry } from "../../core/traits/TraitRegistry";

const OPTION_KEY = TraitRegistry.register<TraitType<IOption>>("select-option");

function Select<T>({ items, value, onChange }: SelectProps<T>) {
    const options = resolveTraited<IOption>(items, OPTION_KEY);
    // options is always IOption[] from here — consume normally
}
```

**Two usage tiers:**
- **Direct** — caller passes `IOption[]` directly (data already matches the component's native shape). No mapping needed.
- **Explicit** — caller passes `traited(myData, { label: d => d.name, value: d => d.id })` for foreign data shapes.

**Rules:**
- Old accessor props (`getLabel`, `getValue`, `getIcon`, etc.) are removed at point of conversion — no dual approach.
- `TraitSet` has no type parameters. `Traited<V>` has one (the target value type).
- The `TraitRegistry.register()` call is co-located with the component (one key per component), not in a global registry file.
- Components with a single scalar value (e.g. `Checkbox`, `Input`, `TextField`) do not use this pattern — it applies only to list/collection props.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-437 | Design system HTML — tokens, component library, and Persephone screen mockups | Closed |
| [US-438](../tasks/US-438-pattern-research/README.md) | Pattern research — adopted patterns + component naming table | Phase 0 / Active |
| US-439 | New components folder setup + CLAUDE.md | Phase 1 / Planned |
| US-426 | Design tokens — spacing, sizing, border-radius, font-size constants | Phase 1 / Planned |
| US-427 | Layout primitives — Flex, HStack, VStack, Panel, Card, Spacer | Phase 1 / Planned |
| US-440 | Bootstrap component set — minimal components needed for Storybook | Phase 2 / Planned |
| US-434 | Storybook editor — component browser, live preview, property editor | Phase 3 / Planned |
| US-435 | Storybook — script tab for building and testing UI via scripts | Phase 3 / Planned |
| US-432 | Dialog component — new implementation + migration (Phase 4, first component) | Phase 4 / Planned |
| US-436 | Script UI API — expose new component library to scripting engine | Phase 6 / Planned |

> US-433 (Editor migration) is superseded — migration is now per-component during Phase 4. Individual tasks will be created as each component is implemented and tested.

## Phase Plan

**Phase 0 — Pattern Research and Naming (US-438)**
Patterns already adopted (see Design Decisions above). Final deliverable: a naming table mapping existing component names to new library names, with proposed property names. The table becomes the reference for all subsequent component tasks. All implementation is blocked until naming is reviewed and agreed on.

**Phase 1 — Folder Setup and Foundations (US-439, US-426, US-427)**
Three parallel workstreams, all new code — no changes to existing components:
- **US-439** — Create the new components folder. Write CLAUDE.md encoding all adopted patterns, naming conventions, and component authoring rules. This must exist before the first component is written.
- **US-426** — Design token constants (spacing, sizing, border-radius, font-size scales from Design Decision #1).
- **US-427** — Layout primitives: Flex, HStack, VStack, Panel, Card, Spacer. Pure composition, no interaction state — safe to build before Storybook exists.

**Phase 2 — Bootstrap Components (US-440)**
Implement the minimal set of components that the Storybook editor UI itself needs (e.g. Button, Input, Label, and whatever else the Storybook shell requires). Pure implementation — no Storybook testing yet, no replacement of old components. This is a short, focused phase to unblock Phase 3.

**Phase 3 — Storybook Editor (US-434, US-435)**
Build the Storybook editor as a built-in Persephone editor type, using the Phase 2 bootstrap components. As a side effect, this validates and tweaks the bootstrap components — they become the first components tested in Storybook. Storybook is the testing tool for all phases that follow.

**Phase 4 — Full Component Library (iterative, one component at a time)**
For each component in the naming table (from US-438):
1. Analyze all Persephone UI locations that use the old equivalent — collect all states, props, and variants needed
2. Implement the new component in the new folder following the CLAUDE.md rules
3. Add the component to Storybook — test and tweak all states visually
4. Replace the old component throughout the app immediately (while focused on it)

Ordering is driven by dependencies — some components must exist before others can be replaced. Per-component tasks are created individually as each one is reached. Dialog (US-432) is the first planned example.

> Some components may block their own replacement if they depend on other new components not yet built. In those cases, build the dependency first, then return.

**Phase 5 — Complex Component Adoption (AVGrid, List, ComboSelect)**
These virtualized and internally complex components are too risky to rewrite from scratch. Instead, adopt new patterns in place:
- Add `data-type` and `data-*` state attributes
- Apply roving tabindex where missing (List, AVGrid header)
- Apply trait integration (`Traited<V>`) at the data prop level
No full rewrite — incremental improvement only.

**Phase 6 — Script API (US-436)**
Expose the new component library to the scripting engine. Depends on Phases 1–4. EPIC-026 trait interfaces are already available.

## Concerns / Open Questions

1. **Migration scope** — Resolved by iterative per-component approach in Phase 4. Each component is replaced immediately after it is built and tested in Storybook. No big-bang migration. Rarely-used components can simply be left on the old library until needed.
2. **Storybook editor architecture** — Should it be a single editor that renders any component, or should each component define its own storybook configuration file? Need to decide on the component metadata format. To be resolved in US-434 task planning.
3. **Script UI security** — Scripts building arbitrary UIs could create confusing interfaces. Should there be sandboxing or capability limits? To be resolved in US-436 task planning.
4. **Trait integration** — Resolved. See Design Decision #9 for the full pattern.
5. **UI descriptor scope** — Resolved. Narrow scope: only container/contribution-point components (Toolbar, ContextMenu, StatusBar, etc.) expose a `descriptors` prop. Leaf components (Button, Input, etc.) are used via plain JSX and appear as variants inside a parent union. See Design Decision #5.

## Notes

### 2026-04-19 (US-438 complete — naming table)
- Pattern review complete. Adopted: data attributes (#6), roving tabindex (#7), focus trap (#8). Skipped: compound components, variant recipe, asChild. Controlled-by-default confirmed as existing practice.
- Component naming table finalized. Key renames: `Chip→Tag`, `SwitchButtons→SegmentedControl`, `ComboSelect→Select`, `ListMultiselect→MultiSelect`, `List→ListBox`, `Popper→Popover`, `PopupMenu→Menu`, `TreeView→Tree`, `FlexSpace→Spacer`, `CircularProgress→Spinner`, `TextAreaField→Textarea`, `OverflowTooltipText→TruncatedText`.
- New components predicted: `Flex`, `HStack`, `VStack`, `Panel`, `Card`, `Divider`, `Label`, `IconButton`, `Badge`, `ScrollArea`.
- Complex components excluded from new library (adopt in place): `AVGrid`, `RenderGrid`, `CollapsiblePanelStack`.
- Full naming table in [US-438 README](../tasks/US-438-pattern-research/README.md).

### 2026-04-19 (implementation plan rewrite)
- Replaced the old 4-phase consolidation plan with a 6-phase new-library-first plan.
- Key decisions: new components folder isolated from existing ones; CLAUDE.md created before first component; naming table as final US-438 deliverable; Storybook built from bootstrap components then used to test all subsequent components; per-component replace-immediately approach during Phase 4; AVGrid/List/ComboSelect adapted in place (not rewritten) in Phase 5.
- New tasks added: US-439 (folder setup + CLAUDE.md), US-440 (bootstrap component set).
- US-433 (Editor migration) superseded — replaced by per-component tasks created during Phase 4.

### 2026-04-19 (pattern decisions)
- **TraitType<T> and PartialTraitType<T>** added to `src/renderer/core/traits/traits.ts`. These are mapped utility types that derive an accessor-map shape from a component interface — used as the type parameter of `TraitKey` so trait registrations are compiler-checked against the target interface. `resolveTraited<T>(items, key)` added as the companion utility.
- **UI Descriptor pattern** (Design Decision #5) documented. Declarative plain-object UI descriptions (JSON-like, may carry functions) rendered via a component registry. Primary motivation: scripting (no JSX available) and toolbar contribution (replaces current portal/ref approach). Uses discriminated union typing, not generics, for array element types. Scope (all components vs. specialized containers only) is an open question for US-438.
- **Data attributes pattern** (Design Decision #6) adopted (US-438 Pattern 1 ✅). All new library components use `data-*` attributes for interactive state instead of CSS class names. Every component also sets `data-type` on its root element — both for DevTools readability and to enable reliable DOM querying by AI agent scripts (which have full `document` access in the renderer).
- **Roving tabindex** (Design Decision #7) adopted as internal behavior (US-438 Pattern 2 ✅). Keyboard-navigable widgets (Toolbar, TreeView, List, Tab bar, SwitchButtons, AVGrid) implement a single Tab stop + arrow-key navigation internally. Not a public API pattern; callers are unaware of it.
- **Focus trap** (Design Decision #8) adopted as internal behavior (US-438 Pattern 7 ✅). All modal dialogs and blocking overlays trap Tab focus within the modal and restore focus to the opener on close. Applies to `src/renderer/ui/dialogs/`; not applied to non-modal side panels.

### 2026-04-19 (direction change — consolidation-first)
- After several iterations of HTML design mockups, concluded that the current Persephone design (VSCode-inspired) is solid and we cannot easily improve on it by designing from scratch.
- Shifted strategy from **design-first** to **consolidation-first**: unify and clean up what already exists; the act of consolidating will itself improve the design.
- US-437 (HTML design system) is closed as a primary deliverable. The HTML files in `/design/` stay for reference.
- New Phase 0 is **pattern research**: read existing components, identify repeated structures, define component API conventions before writing any library code.
- The two goals going forward: (1) consolidate current design via shared primitives, (2) research and define patterns before implementing the component library.

### 2026-04-18 (vision update)
- Reframed as design-first. HTML prototype (US-437) is now Phase 0 — all implementation is blocked until design is reviewed and patterns are settled.
- Added goal: pattern research and best-practice review as part of Phase 0.
- US-437 added as the first active task: creates a self-contained HTML design system (tokens, all component states, 3–4 Persephone screen mockups) that serves the same role as a Figma spec.
- Moved to Active on 2026-04-18. EPIC-026 dependency updated: Phases 0–2 are unblocked; only Phase 4 (US-436) needs EPIC-026.

### 2026-04-18 (dependency update)
- EPIC-026 trait core (US-428) is complete; drag-and-drop tasks (US-444, US-448, US-449) and documentation (US-446) remain in progress.
- Phase 1–2 (tokens, primitives, dialogs, editor migration) can proceed independently — no EPIC-026 dependency.
- Trait integration patterns are now fully resolved: `T[] | Traited<T[]>` prop type, `resolveTraited(items, KEY)` at component top, `TraitSet` (no type params), `Traited<V>` (one type param for target value). Updated Concern #4 accordingly.
- Dependency note updated: only Phase 4 (US-436) is gated on EPIC-026.

### 2026-04-17
- Initial design discussion. Originally included trait system, later split into EPIC-026.
- Trait system is a prerequisite — components will use `Traited<V>` for data binding.
- Storybook will be a built-in editor type, not external tooling — dogfoods the library.
- Design tokens derived from codebase analysis of actual spacing/sizing/radius/font values used across 100+ files.
