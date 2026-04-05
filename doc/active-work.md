# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-020** — [Browser Network Request Logging & Resource Discovery](epics/EPIC-020.md)
  - [x] [US-362: Network request logging in main process](tasks/US-362-network-request-logging/README.md)
  - [x] [US-363: Merge network logs into Show Resources](tasks/US-363-merge-network-logs-into-show-resources/README.md)
  - [ ] US-364: Open non-GET network requests in RestClient

## Planned

- **EPIC-014** — [Claude Integration via Terminal Editor](epics/EPIC-014.md)
- **EPIC-011** — [Chrome Extension Support for Built-in Browser](epics/EPIC-011.md)
- *(no epic)*
  - [ ] US-347: CategoryView / CategoryEditor Breadcrumb
  - [ ] US-325: Fix webview preload script error in HTML view

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
