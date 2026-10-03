# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [platform roadmap](platform-roadmap.md) (phases A–F, EPIC-105 to EPIC-114) finished on
2026-09-27; its epics are in [`epics/completed.md`](epics/completed.md).

## Active

- **EPIC-120** — [Site extensions — injected AiVision models for web pages](epics/EPIC-120.md) — proof of concept: **go**
  - [ ] [US-1602: PoC — injection hook + late-model discovery fix](tasks/US-1602-site-extension-injection-poc/README.md)
  - [ ] [US-1603: PoC — Outlook model, reliability matrix, go/no-go report](tasks/US-1603-outlook-poc/README.md)
  - [ ] [US-1604: Site extension store, manifest, host matching, injection](tasks/US-1604-site-extension-store/README.md)
  - [ ] [US-1605: Registration and trust](tasks/US-1605-site-extension-trust/README.md)
  - [ ] [US-1613: Site Extensions tab in Tools & Editors](tasks/US-1613-site-extensions-hub-tab/README.md)
  - [ ] [US-1606: Agent tools — create, reload in place, list, remove](tasks/US-1606-site-extension-agent-tools/README.md)
  - [ ] [US-1607: Site extension authoring guide and agent workflow](tasks/US-1607-site-extension-guides/README.md)
  - [ ] [US-1612: Quieter page-model events](tasks/US-1612-quieter-page-model-events/README.md)

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
