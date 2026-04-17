# EPIC-025: Unified Component Library and Storybook Editor

## Status

**Status:** Planned
**Created:** 2026-04-17

## Overview

Consolidate all UI elements in Persephone (buttons, inputs, panels, containers, layout primitives) into a unified, well-tested component library. Add a built-in **Storybook editor** for interactive component testing and documentation. Expose the component library to the scripting engine so scripts can build custom editor UIs from tested building blocks. Components will use the **trait system** (EPIC-026) for data binding, applied naturally during development.

## Goals

- **Consistent styling** across the entire application through shared layout primitives and design tokens
- **Better code reuse** — eliminate 140+ inline `styled.div` definitions scattered across editors
- **Built-in Storybook editor** — interactive component browser with property editor for testing and documentation
- **Script-accessible UI** — scripts can build custom editor UIs using the component library

## Dependencies

- **EPIC-026** (Trait System) — should be completed first. Components will use traits for data binding. The trait system provides `TraitSet`, `Traited`, and `resolveTraited()` which this epic's components will accept.

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

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-426 | Design tokens — spacing, sizing, border-radius, font-size constants | Planned |
| US-427 | Layout primitives — Flex, HStack, VStack, Panel, Card, Spacer | Planned |
| US-432 | Dialog consolidation — unify UI dialogs and log-view dialogs into composable base | Planned |
| US-433 | Editor migration — replace inline styled containers with layout primitives (incremental) | Planned |
| US-434 | Storybook editor — component browser, live preview, property editor | Planned |
| US-435 | Storybook — script tab for building and testing UI via scripts | Planned |
| US-436 | Script UI API — expose component library to scripting engine | Planned |

## Phase Plan

**Phase 1 — Foundations (US-426, US-427)**
Design tokens and layout primitives. Immediate value, low risk. New code only — no existing code changes.

**Phase 2 — Component Consolidation (US-432, US-433)**
Unify dialog system, migrate editors to layout primitives. Higher risk — touches many files. Incremental approach.

**Phase 3 — Storybook Editor (US-434, US-435)**
Built-in testing and documentation tool. Depends on Phase 1. Dogfoods the component library.

**Phase 4 — Script API (US-436)**
Expose components to scripts. Depends on Phases 1-2.

## Concerns / Open Questions

1. **Migration scope for Phase 2** — 140+ inline styled definitions across editors. Full migration is high effort. Consider migrating only high-traffic editors first and leaving rarely-used ones for later.
2. **Storybook editor architecture** — Should it be a single editor that renders any component, or should each component define its own storybook configuration file? Need to decide on the component metadata format.
3. **Script UI security** — Scripts building arbitrary UIs could create confusing or malicious interfaces. Should there be sandboxing or capability limits?
4. **Trait integration** — Components will accept `Traited` data (from EPIC-026). The exact prop patterns will be defined during implementation, informed by EPIC-026's decisions.

## Notes

### 2026-04-17
- Initial design discussion. Originally included trait system, later split into EPIC-026.
- Trait system is a prerequisite — components will use `Traited<T, V>` for data binding.
- Storybook will be a built-in editor type, not external tooling — dogfoods the library.
- Design tokens derived from codebase analysis of actual spacing/sizing/radius/font values used across 100+ files.
