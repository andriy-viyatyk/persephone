# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-137** — [Notebook moves to a published board](epics/EPIC-137.md)
  - [ ] BT-078 *(persephone-boards)*: Notebook board — scaffold, format-preserving model, paged card list, CodeMirror, search
  - [ ] BT-079 *(persephone-boards)*: Notebook board — Categories & Tags secondary view
  - [ ] BT-080 *(persephone-boards)*: Notebook board — Markdown preview and av-grid view for JSON array notes
  - [ ] BT-081 *(persephone-boards)*: Notebook board — aiVision model, guides, language packs; publish v1.0.0
  - [ ] [US-1771: Board toolbar breadcrumb control](tasks/US-1771-board-toolbar-breadcrumb/README.md)
  - [ ] [US-1769: Remove the built-in Notebook editor from the core](tasks/US-1769-remove-builtin-notebook/README.md)
  - [ ] [US-1770: Research — simplify editor architecture that existed only for Notebook](tasks/US-1770-editor-architecture-simplification/README.md)
  - [ ] [US-1772: Remove editor state storage](tasks/US-1772-remove-editor-state-storage/README.md)
  - [ ] [US-1773: Remove the editor overlay portal](tasks/US-1773-remove-editor-overlay/README.md)
  - [ ] [US-1774: Remove embedded body-view scaffolding](tasks/US-1774-remove-embedded-body-views/README.md)
  - [ ] [US-1775: Narrow the content-host contract](tasks/US-1775-narrow-content-host/README.md)
  - [ ] [US-1776: Remove HTML preview focus announcement](tasks/US-1776-remove-html-focus-announcement/README.md)

## Planned

## Scheduled

Tasks that must not start before a date. When the date arrives, move the entry to **Active** (or
**Planned**) and investigate it as usual.

- [ ] **2027-01-03** — [US-1609: Remove the legacy (undeclared) board permission fallback](tasks/US-1609-remove-legacy-board-permissions/README.md) — ends the EPIC-119 / US-1608 deprecation period
- [ ] **2027-02-01** — [US-1757: Upgrade Castlabs Electron (recurring)](tasks/US-1757-castlabs-electron-upgrade/README.md) — recurring every ~3 months; when picked up, first schedule the next round (step 0 of the doc)

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
