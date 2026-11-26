# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-215** — [Linux native helpers and media (multiplatform phase 3)](epics/EPIC-215.md)
  - [ ] US-2224: Capture mechanisms on GNOME Wayland — done, decisions in the epic
  - [ ] [US-2225: Linux builds of the Rust helpers](tasks/US-2225-linux-rust-helpers/README.md)
  - [ ] [US-2226: Mneme on Linux](tasks/US-2226-mneme-linux/README.md)
  - [ ] [US-2227: Screen snip on Linux](tasks/US-2227-snip-linux/README.md)
  - [ ] [US-2228: System audio and meeting transcript on Linux](tasks/US-2228-linux-system-audio/README.md)
  - [ ] [US-2229: Hide clipboard history on Linux](tasks/US-2229-hide-clipboard-history-linux/README.md)
  - [ ] US-2230: Phase 3 exit run

## Planned

- *(no epic)*
  - [ ] [US-2139: Board hotkeys](tasks/US-2139-board-hotkeys/README.md) — recorded idea, not investigated: a board declares an action with a default hotkey, the user can rebind it, and it works with no board page open

## Scheduled

Tasks that must not start before a date. When the date arrives, move the entry to **Active** (or
**Planned**) and investigate it as usual.

- [ ] **2027-01-03** — [US-1609: Remove the legacy (undeclared) board permission fallback](tasks/US-1609-remove-legacy-board-permissions/README.md) — ends the EPIC-119 / US-1608 deprecation period
- [ ] **2027-02-01** — [US-1757: Upgrade Castlabs Electron (recurring)](tasks/US-1757-castlabs-electron-upgrade/README.md) — recurring every ~3 months; when picked up, first schedule the next round (step 0 of the doc)
- [ ] **2027-02-15** — [US-2019: Dependency refresh (recurring)](tasks/US-2019-dependency-refresh/README.md) — recurring every ~3 months; when picked up, first schedule the next round (step 0 of the doc). Watch list includes TypeScript 7

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
