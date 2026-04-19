# US-438: Pattern Research — Component API Conventions

## Goal

Review candidate design patterns for Persephone's component library. For each pattern, understand what value it brings, decide whether to adopt it, and record the decision with rationale. The output of this task is a set of resolved design decisions that inform all subsequent implementation tasks (US-426 onward).

## Background

EPIC-025 shifted from design-first to consolidation-first (2026-04-19). Before writing any component code, we research patterns used in established libraries (Radix UI, shadcn/ui, React Aria, VS Code) and decide which ones fit Persephone's use cases.

Two patterns were already decided before this task was created:
- **TraitType\<T\>** — implemented in `src/renderer/core/traits/traits.ts`. Accessor-map type derived from component interface; used as `TraitKey<TraitType<IOption>>` for type-safe trait registration. `resolveTraited<T>()` is the companion utility.
- **UI Descriptor** — documented in EPIC-025 Design Decision #5. Declarative plain-object descriptions rendered via a component registry. Primary use: scripting (no JSX) and toolbar contribution (replaces portal/ref approach).

## Patterns Reviewed

| # | Pattern | Document | Decision |
|---|---------|----------|----------|
| 1 | Data attributes for interactive state | [01-data-attributes.md](01-data-attributes.md) | ✅ Adopt — incl. `data-type` on every component |
| 2 | Roving tabindex for keyboard navigation | [02-roving-tabindex.md](02-roving-tabindex.md) | ✅ Adopt (internal) — Toolbar, TreeView, List, Tab bar, etc. |
| 3 | Compound components with implicit context | [03-compound-components.md](03-compound-components.md) | ❌ Skip — internal library, element types known |
| 4 | Component variant recipe | [04-variant-recipe.md](04-variant-recipe.md) | ❌ Skip — design token constants are sufficient |
| 5 | Controlled-by-default (no uncontrolled mode) | [05-controlled-by-default.md](05-controlled-by-default.md) | ✅ Already our practice — enforce as convention |
| 6 | asChild polymorphism | [06-aschild-polymorphism.md](06-aschild-polymorphism.md) | ❌ Skip — internal library, element types always fixed |
| 7 | Focus trap | [07-focus-trap.md](07-focus-trap.md) | ✅ Adopt (internal) — all modal dialogs and blocking overlays |
| 8 | Dismissable layer / click-outside | [08-dismissable-layer.md](08-dismissable-layer.md) | 🔀 Skip (covered by Floating UI already in use) |

## Component Naming Table

Existing components mapped to new library names, plus predicted new components. New components can be added on demand — this is not an exhaustive list.

### Existing components → new names

| Old name | Old path | New name | Notes |
|----------|----------|----------|-------|
| `Button` | `basic/Button` | `Button` | Good name. Props: `onClick`, `disabled`, `variant`, `size` |
| `Checkbox` | `basic/Checkbox` | `Checkbox` | Good name. Props: `checked`, `onChange`, `disabled`, `label` |
| `Radio` | `basic/Radio` | `Radio` | Good name. Props: `checked`, `onChange`, `disabled`, `label` |
| `Input` | `basic/Input` | `Input` | Good name. Props: `value`, `onChange`, `disabled`, `placeholder` |
| `TextField` | `basic/TextField` | `TextField` | Label + Input combo. Props: `value`, `onChange`, `label`, `disabled` |
| `TextAreaField` | `basic/TextAreaField` | `Textarea` | Drop "Field" — name is redundant. Props: `value`, `onChange`, `disabled`, `rows` |
| `PathInput` | `basic/PathInput` | `PathInput` | Specialized — keep name |
| `Chip` | `basic/Chip` | `Tag` | "Tag" is the standard name in VS Code and most tooling UIs |
| `TagsList` | `basic/TagsList` | `TagList` | Rename to match `Tag`. Internal to tag inputs |
| `Tooltip` | `basic/Tooltip` | `Tooltip` | Good name. Props: `content`, `children`, `placement` |
| `OverflowTooltipText` | `basic/OverflowTooltipText` | `TruncatedText` | Describes what it does — shows tooltip when text is truncated |
| `CircularProgress` | `basic/CircularProgress` | `Spinner` | Standard name for an indeterminate loading indicator |
| `Breadcrumb` | `basic/Breadcrumb` | `Breadcrumbs` | Plural is the standard (the component renders multiple crumbs) |
| `SwitchButtons` | `form/SwitchButtons` | `SegmentedControl` | Standard name — a row of exclusive options. Props: `value`, `onChange`, `options`, `disabled` |
| `ComboSelect` | `form/ComboSelect` | `Select` | Standard name for a dropdown select. Props: `value`, `onChange`, `options`, `disabled`, `placeholder` |
| `ListMultiselect` | `form/ListMultiselect` | `MultiSelect` | Clearer. Props: `value`, `onChange`, `options`, `disabled` |
| `List` | `form/List` | `ListBox` | ARIA term for a selectable list. Props: `items`, `selectedItem`, `onSelect`, `disabled` |
| `Popper` | `overlay/Popper` | `Popover` | "Popper" is the positioning engine name. "Popover" is the component. Props: `open`, `onClose`, `anchor`, `placement` |
| `PopupMenu` | `overlay/PopupMenu` | `Menu` | Standard name. Props: `items`, `onSelect` |
| `TreeView` | `TreeView/TreeView` | `Tree` | Shorter, matches common convention. Children are `Tree.Item` or separate `TreeItem`. Props: `items`, `selectedItem`, `onSelect`, `onExpand` |
| `Splitter` | `layout/Splitter` | `Splitter` | Good name — keep |
| `FlexSpace` | `layout/Elements` | `Spacer` | Already planned in US-427. Props: `size?` (fixed size, or `flex: 1` when omitted) |

### Excluded from new library (complex / adapt in place)

| Component | Reason |
|-----------|--------|
| `AVGrid` | Virtualized data grid — too complex to rewrite. Adopt patterns in place (Phase 5) |
| `RenderGrid` / `RenderFlexGrid` | Internal virtualization primitives — not part of public library |
| `ComboTemplate` | Internal implementation detail of `ComboSelect` |
| `InputBase` | Internal base of `Input` |
| `CollapsiblePanelStack` | App-specific panel layout — evaluate during migration |
| `CategoryView` / `CategoryTree` / `TreeProviderView` | App-specific tree wrappers — not library components |
| `PageManager` / `AppPageManager` | App infrastructure |
| `FileSearch` | App-specific feature |
| `Minimap` | Editor-specific feature |
| `FileIcon` / `LanguageIcon` | App-specific icons |
| `EditorErrorBoundary` | App infrastructure |

### New components (predicted, no old equivalent)

| New name | Purpose |
|----------|---------|
| `Flex` | Configurable flex container. Props: `direction`, `gap`, `align`, `justify`, `wrap` |
| `HStack` | Horizontal flex shortcut. Props: `gap`, `align`, `justify` |
| `VStack` | Vertical flex shortcut. Props: `gap`, `align`, `justify` |
| `Panel` | Bordered container with padding and background. Props: `padding`, `gap` |
| `Card` | Elevated panel with shadow. Props: `padding` |
| `Divider` | Horizontal or vertical separator line. Props: `orientation` |
| `Label` | Form field label. Props: `htmlFor`, `required`, `disabled` |
| `IconButton` | Button with icon only (no text label). Props: `icon`, `onClick`, `disabled`, `title` |
| `Badge` | Small count or status indicator overlaid on another element. Props: `count`, `children` |
| `ScrollArea` | Custom-styled scroll container (if needed). Props: `maxHeight`, `maxWidth` |

> This list is not exhaustive. New components are added on demand as each Phase 4 implementation task discovers a need.

## Acceptance Criteria

- [x] All 8 patterns have a decision with rationale
- [x] Adopted patterns documented in EPIC-025 Design Decisions (#6, #7, #8)
- [x] Component naming table completed
