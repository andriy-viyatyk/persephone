# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-026** — [Trait System — Universal Data Adaptation Layer](epics/EPIC-026.md)
  - [ ] [US-428: Trait system core — TraitKey, TraitSet, Traited, traited()](tasks/US-428-trait-system-core/README.md)
  - [ ] [US-444: Trait-based drag-drop infrastructure + link pilot — TraitRegistry, serialization, native HTML5 DnD, convert link-drag](tasks/US-444-trait-drag-drop-infrastructure/README.md)
  - [ ] US-447: Convert remaining data drags to trait-based system — todo, notes, REST, browser tabs, pinned links, explorer files/folders
  - [ ] US-448: Cross-type drop targets — FILE_FOLDER→Links import, cross-editor category drops, LINK→RestClient
  - [ ] US-449: Remove React-DnD dependency — convert component-level drags to native HTML5
  - [ ] US-445: Editor facade refactor — replace as*() methods with trait-based discovery
  - [ ] US-446: Documentation — trait system guide in /doc/architecture/


## Planned

- **EPIC-025** — [Unified Component Library and Storybook Editor](epics/EPIC-025.md) *(depends on EPIC-026)*
  - [ ] US-426: Design tokens — spacing, sizing, border-radius, font-size constants
  - [ ] US-427: Layout primitives — Flex, HStack, VStack, Panel, Card, Spacer
  - [ ] US-432: Dialog consolidation — unify UI dialogs and log-view dialogs
  - [ ] US-433: Editor migration — replace inline styled containers with layout primitives
  - [ ] US-434: Storybook editor — component browser, live preview, property editor
  - [ ] US-435: Storybook — script tab for building and testing UI via scripts
  - [ ] US-436: Script UI API — expose component library to scripting engine
- **EPIC-022** — [LinkEditor Embedded Scripts](epics/EPIC-022.md)
  - [ ] US-396: Data model — `LinkScriptItem` type and `scripts` field in `LinkEditorData`
  - [ ] US-397: ScriptRunner — `runWithScope()` for custom context variable injection
  - [ ] US-398: LinkEditorScriptProvider — virtual IProvider backed by LinkViewModel
  - [ ] US-399: Resolver — handle `link-editor-script://` URL scheme
  - [ ] US-400: Scripts panel UI — collapsible panel with tree view in LinkEditor
  - [ ] US-401: Add/Edit Script dialog
  - [ ] US-402: Script execution engine — event matching and execution in LinkViewModel
  - [ ] US-403: Script types and facade for script API
- **EPIC-014** — [Claude AI Chat Panel](epics/EPIC-014.md)
  - [ ] US-385: Right panel slot in Pages.tsx layout
  - [ ] US-386: ClaudeChatModel + SDK integration (query, streaming, abort)
  - [ ] US-387: Chat UI — message list, input, markdown rendering
  - [ ] US-388: MCP auto-registration + page context injection
  - [ ] US-389: Conversation persistence + session resume
  - [ ] US-390: Settings: API key, model, system prompt
  - [ ] US-391: PowerShell shortcut (Ctrl+\`) — open shell at cwd
- **EPIC-011** — [Chrome Extension Support for Built-in Browser](epics/EPIC-011.md)
- *(no epic)*
  - [ ] US-347: CategoryView / CategoryEditor Breadcrumb


---

## How This Dashboard Works

### Structure

Each section (Active / Planned) lists epics as top-level items and tasks as sub-items:

```
- **EPIC-XXX** — [Title](epics/EPIC-XXX.md)
  - [ ] US-YYY: Task title
  - [x] US-ZZZ: Completed task title
- *(no epic)*
  - [ ] US-AAA: Standalone task
```

### Starting work

1. Move an epic or task from **Planned** to **Active**
2. Mark the task `[ ]` → `[x]` when done

### Completing a standalone task (no epic)

1. Mark task `[x]` in Active section
2. Move it to [`/doc/tasks/completed.md`](tasks/completed.md)
3. Remove from this dashboard

### Completing an epic

1. All tasks under the epic should be `[x]`
2. Move the entire epic block (with tasks) to [`/doc/epics/completed.md`](epics/completed.md)
3. Remove from this dashboard

### Creating new work

- **New epic:** Add to Planned with link to its doc in `/doc/epics/`
- **New task (with epic):** Add as sub-item under the epic
- **New task (standalone):** Add under `*(no epic)*`

### Task ID Format

`US-XXX` — sequential number. `EPIC-XXX` — sequential number.
