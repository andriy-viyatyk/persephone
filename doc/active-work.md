# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [platform roadmap](platform-roadmap.md) (phases A–F, EPIC-105 to EPIC-114) finished on
2026-09-27; its epics are in [`epics/completed.md`](epics/completed.md).

## Active

- **EPIC-124** — [Localization foundation](epics/EPIC-124.md) (phase 1 of the
  [localization roadmap](localization-roadmap.md); phases 2–4 get epic numbers when they start)
  - [x] [US-1647: i18n core — catalogs, `t()`, plurals, pack loading and layering, `en-XA`](tasks/US-1647-i18n-core/README.md)
  - [x] [US-1648: Stable ids for dialog buttons and menu items; split mixed UI/agent text](tasks/US-1648-stable-ui-ids/README.md)
  - [x] [US-1649: `language` setting, Settings picker, reload on switch, startup locale](tasks/US-1649-language-setting/README.md)
  - [x] [US-1650: Locale-aware formatting through `Intl`](tasks/US-1650-locale-formatting/README.md)
  - [x] [US-1651: Localization conventions doc, ESLint rule, `npm run i18n:check`](tasks/US-1651-i18n-conventions/README.md)
  - [x] [US-1652: Pilot extraction — Settings page and all dialogs, verified under `en-XA`](tasks/US-1652-pilot-extraction/README.md)

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
