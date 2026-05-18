# EPIC-027: Script-Driven UI and Custom Editors

## Status

**Status:** Planned
**Created:** 2026-05-19
**Carved out of:** [EPIC-025](EPIC-025.md) — the original Phase 6 ("Script Integration") plus a new custom-editor framework, lifted into a standalone epic because the EPIC-025 surface is already large and script integration is a substantial direction of its own.

## Overview

Once the UIKit catalog is stable and EPIC-025 has migrated every screen to it, the same primitives should be reachable from the scripting engine. A script that opens a custom-shaped page (a form, a dashboard, a tool panel) should compose UIKit components instead of hand-rolling HTML. The endpoint is **scripts as a first-class authoring surface for UI**: scripts can build self-contained UIs *and* register entirely new editor types that the page/tab system loads on demand.

This epic has three pieces that build on each other:

1. **Script UI API** — expose UIKit components (and the trait system) through the script namespace so scripts can construct UIs declaratively.
2. **Storybook script tab** — a script editor inside the Storybook page where users author/test UI scripts against the same components Storybook is exercising. This is the dogfooding surface for the API.
3. **Script-registered custom editors** — scripts register editor types that integrate with the page/tab system: opened via the editor registry, restored across sessions where feasible, and authored entirely in user-supplied script code.

EPIC-025's Phase 6 ("Script Integration") originally tried to fit pieces 1 and 2 inside the UIKit consolidation epic. Piece 3 (custom editors) was implicit in the long-term vision but never written down. Splitting them out lets this work be planned on its own terms, with its own architecture decisions, without further inflating EPIC-025.

## Goals

- **Script UI API** — scripts can build UIs from the same UIKit primitives the app uses. Layout primitives (`Panel`, `Flex`, `HStack`, `VStack`), form primitives (`Input`, `Select`, `MultiSelect`, `Textarea`, `Checkbox`), interactive surfaces (`Button`, `IconButton`, `Menu`, `Popover`), and data surfaces (`ListBox`, `Tree`, `AVGrid`, `RenderGrid`) all reachable from a script.
- **Trait system available to scripts** — the `Traited<V>` / `TraitRegistry` mechanism (EPIC-026) is exposed so scripts can adapt foreign data into UIKit's native shapes without rewriting it.
- **Storybook script tab** — a Monaco-backed script tab inside the Storybook editor where authors write and run UI scripts, verifying the result against the same components Storybook is already showing.
- **Script-registered custom editors** — a registration API (`app.editors.register(type, factory)` or similar) that lets scripts contribute new editor types to the editor registry. Pages opened with that editor type instantiate the script-provided component as the editor surface. Registration happens at script-load time (autoload library or explicit script).
- **Lifecycle parity with built-in editors** — script-registered editors participate in tab open/close, content save/restore, dirty-state, find/replace where the script opts in, and ideally persistence across app restarts when the script that registered them is autoloaded.

## Dependencies

- **EPIC-025** (Unified Component Library and Storybook Editor) — must be **complete** before this epic starts. Reasons:
  - The UIKit prop shapes need to be settled. Exposing a moving target to scripts would force constant API rework.
  - Storybook editor must exist (it hosts the script tab in piece 2).
  - All screens migrated to UIKit confirms the primitive catalog is sufficient for real UIs — a much stronger signal than a synthetic test that the API will work for scripts too.
- **EPIC-026** (Trait System) — complete. `Traited<V>`, `resolveTraited`, `TraitRegistry` are available; this epic exposes them through the script namespace.

## Design Direction (rough — to be refined in task planning)

### Script UI surface

A script accesses UI primitives via a namespace on the script context, paralleling how it already reaches `app`, `page`, `io`, `ai`:

```typescript
// Sketch only — exact shape TBD in US-436 task planning
const { Panel, HStack, Button, Input, Tree } = ui.components;
const root = Panel({ flex: 1 }, [
    HStack({ gap: 8 }, [
        Input({ value: state.query, onChange: (v) => state.setQuery(v) }),
        Button({ onClick: () => runSearch() }, "Search"),
    ]),
    Tree({ items: state.results, ... }),
]);
ui.render(root);
```

Open questions:
- Function-call API (above) vs. JSX (transpiled in the script worker) vs. UI-descriptor (`ComponentSet`-style discriminated union) — to be decided. The descriptor approach (Design Decision #5 in EPIC-025) is already JSON-shaped and was originally written with scripts in mind; that is the leading candidate.
- How does a script-rendered UI participate in React's lifecycle when scripts run in a worker?

### Storybook script tab

A new tab inside the Storybook editor (`StorybookEditor.tsx`) backed by a Monaco editor with the UI-API typings preloaded. The "Run" button executes the script and renders the result in the existing Storybook preview area. Acts as both:
- A live playground for authoring UI scripts.
- A test target — script-based "stories" that the Storybook editor can replay to verify regressions.

### Script-registered custom editors

A script declares a new editor type by calling something like:

```typescript
// Sketch only — exact shape TBD in US-544 task planning
app.editors.register({
    type: "my-custom-editor",
    displayName: "My Custom Editor",
    canHandle: (pipe) => pipe.sourceUrl?.endsWith(".myext"),
    create: (ctx) => {
        // ctx provides: pipe (content I/O), state (persisted), api (page hooks)
        return ui.components.Panel({ flex: 1 }, [...]);
    },
});
```

The editor registry routes opens to the script-provided factory the same way it routes to built-in editor types today. Persistence across restart works only if the registering script is part of the autoload library (otherwise the editor type is unknown on the next session).

Open questions:
- How does the script-side editor interact with `IContentHost` / `acquireViewModelSync` (the host pattern used by built-in editors)?
- Save/restore: does the editor's persisted state round-trip through `IEditorState.pipe` (`IPipeDescriptor`), or does the script need its own serialization hook?
- Sandboxing — scripts get full `document` access today. Custom editors don't add a new capability boundary, but they do introduce a long-lived UI surface; behavior on script reload (autoload library edited mid-session) needs design.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-436 | Script UI API — expose new component library to scripting engine | Planned |
| US-435 | Storybook — script tab for building and testing UI via scripts | Planned |
| US-544 | Script-registered custom editor framework — registration, lifecycle, persistence | Planned (placeholder — task spec TBD when epic starts) |

> US-436 and US-435 were originally Phase 6 of EPIC-025; moved here when the script-integration surface was carved out into its own epic.

## Open Concerns

| # | Concern | Status |
|---|---------|--------|
| C1 | API shape — function-call vs. JSX-in-worker vs. UI-descriptor (`ComponentSet`-style) | Open — resolve in US-436 task planning. Leading candidate: UI-descriptor, since `ComponentSet` was designed with scripts in mind (see EPIC-025 Design Decision #5). |
| C2 | React lifecycle from a worker — scripts run in a worker today; UIKit components are React components running in the renderer. How does the script's descriptor tree get reconciled with React's render tree across that boundary? | Open — resolve in US-436 task planning. |
| C3 | Script UI capability limits — scripts already have full `document` access. A long-lived script UI doesn't add a new capability boundary, but does need a clear story for what happens when the script that owns it is edited or reloaded. | Open — resolve in US-544 task planning. (Originally raised as EPIC-025 Concern #3.) |
| C4 | Custom-editor persistence — how does a script-registered editor's state round-trip through `IEditorState.pipe`? Does the script provide a serializer, or does the framework default to `JSON.stringify` over the state object? | Open — resolve in US-544 task planning. |
| C5 | Autoload dependency — restored sessions need the registering script loaded *before* the first page using its editor type is reopened. The autoload library is the natural home, but ordering against page-restore needs to be verified. | Open — resolve in US-544 task planning. |

## Notes

### 2026-05-19 (epic created from EPIC-025 carve-out)
- Carved out of EPIC-025 Phase 6 ("Script Integration") plus a new piece — script-registered custom editors — that was previously only implicit in the long-term vision.
- US-436 and US-435 moved here verbatim; US-544 added as the placeholder for the custom-editor framework.
- Reason for split: EPIC-025 has grown to ~80+ Phase 4 tasks (per-screen UIKit migrations + UIKit primitive additions). Script integration is a substantial design surface of its own and benefits from being planned independently after the UIKit catalog settles.
- Sequencing: this epic is blocked on EPIC-025 close. Driving it sooner would mean reworking the script API every time a UIKit prop changes during per-screen migration.
