# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [localization roadmap](localization-roadmap.md) is in progress: phase 1 (foundation,
[EPIC-124](epics/completed.md)) is done; phase 2 (extract every UI string) is EPIC-125 below; then
phase 3 (boards localization) and phase 4 (the 17 built-in language packs and the Language Editor).

## Active

- **EPIC-125** — [Extract every UI string (interface languages, phase 2)](epics/EPIC-125.md)
  - [ ] [US-1653: Widen the lint rule to every UI position; per-area baseline](tasks/US-1653-lint-coverage/README.md)
  - [ ] [US-1654: App shell, tabs, sidebar, editor display names](tasks/US-1654-shell-strings/README.md)
  - [ ] [US-1655: Menus and context menus, tree providers, shared editor menus, file components](tasks/US-1655-menu-strings/README.md)
  - [ ] [US-1656: API layer, content pipeline, notifications outside editors](tasks/US-1656-api-strings/README.md)
  - [ ] [US-1657: Browser editor](tasks/US-1657-browser-strings/README.md)
  - [ ] [US-1658: Board host: board editor, board info, env vars, toolsets](tasks/US-1658-board-host-strings/README.md)
  - [ ] [US-1659: Explorer and link editor](tasks/US-1659-explorer-links-strings/README.md)
  - [ ] [US-1660: Git tree, file diff, compare, archive](tasks/US-1660-git-diff-strings/README.md)
  - [ ] [US-1661: Mneme editors and About](tasks/US-1661-mneme-about-strings/README.md)
  - [ ] [US-1662: MCP inspector, Tools hub, Storybook](tasks/US-1662-tools-strings/README.md)
  - [ ] US-1663: Remaining editors and uikit defaults
  - [ ] US-1664: Monaco UI language (D9)
  - [ ] US-1665: Layout fixes, lint rule to error, closing sweep

## Planned

*(none)*

## Scheduled

Tasks that must not start before a date. When the date arrives, move the entry to **Active** (or
**Planned**) and investigate it as usual.

- [ ] **2027-01-03** — [US-1609: Remove the legacy (undeclared) board permission fallback](tasks/US-1609-remove-legacy-board-permissions/README.md) — ends the EPIC-119 / US-1608 deprecation period

Recorded epic ideas live in [`tasks/backlog.md`](tasks/backlog.md).

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

### Scheduled work

The **Scheduled** section holds tasks with a not-before date, written as `**YYYY-MM-DD**` at the
start of the entry and sorted by date. Agents reading the dashboard should mention any entry whose
date has passed. When it is due, move it to Active or Planned.

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

- **New epic:** Add to Planned with link to its doc in `/doc/epics/` — but only when it is
  genuinely next up. An epic that is a recorded idea rather than scheduled work belongs in
  [`/doc/tasks/backlog.md`](tasks/backlog.md) under "Recorded Epics", with its doc's
  **Status** set to `Backlog`. Move it here when work is about to start.
- **New task (with epic):** Add as sub-item under the epic
- **New task (standalone):** Add under `*(no epic)*`

### Task ID Format

`US-XXX` — sequential number. `EPIC-XXX` — sequential number.
