# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [platform roadmap](platform-roadmap.md) (phases A–F, EPIC-105 to EPIC-114) finished on
2026-09-27; its epics are in [`epics/completed.md`](epics/completed.md).

## Active

- **EPIC-119** — [Board permissions — least privilege, declared in the manifest](epics/EPIC-119.md)
  - [ ] [US-1593: Permission model — bridge surface inventory, manifest schema, core enforcement](tasks/US-1593-board-permission-model/README.md)
  - [ ] [US-1596: Scoped file access for boards](tasks/US-1596-board-scoped-file-access/README.md)
  - [ ] [US-1597: Device permissions for board frames](tasks/US-1597-board-device-permissions/README.md)
  - [ ] [US-1598: Trust dialog and Board Info show granted permissions; re-trust on change](tasks/US-1598-board-permission-trust-ui/README.md)
  - [ ] [US-1599: Scaffold all-`false` manifest; board guides and agent instructions](tasks/US-1599-board-permission-scaffold-guides/README.md)
  - [ ] US-1600: `persephone-boards` catalog permissions + safe viewers; republish all boards
  - [ ] US-1601: Migrate the user's registered custom boards (Codex run per board)
  - [ ] [US-1608: Deprecation notice for boards without declared permissions](tasks/US-1608-legacy-board-deprecation-notice/README.md)

## Planned

- [ ] [US-1595: Agents can see and dismiss native dialogs](tasks/US-1595-native-dialog-agent-dismiss/README.md) — async download Save dialog, `windows[i].nativeDialog` + `dismiss()`

- **EPIC-120** — [Site extensions — injected AiVision models for web pages](epics/EPIC-120.md) — proof of concept first
  - [ ] US-1602: PoC — injection hook + late-model discovery fix
  - [ ] US-1603: PoC — Outlook model, reliability matrix, go/no-go report
  - [ ] US-1604: Site extension store, manifest, host matching *(draft, after PoC)*
  - [ ] US-1605: Registration and trust *(draft, after PoC)*
  - [ ] US-1606: Agent tools — scaffold, reload, list, remove *(draft, after PoC)*
  - [ ] US-1607: Guides and agent workflow *(draft, after PoC)*

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
