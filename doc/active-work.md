# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-199** — [Agent surface fixes from the ai-vision feedback log](epics/EPIC-199.md)
  - [ ] [US-2121: Snapshot names: icon buttons, tree rows, menu ids, missing `data-name`s](tasks/US-2121-snapshot-names/README.md)
  - [ ] [US-2122: `$help` return types and member drift](tasks/US-2122-help-return-types/README.md)
  - [ ] [US-2123: `pressKey` reaches main-process shortcuts](tasks/US-2123-presskey-main-shortcuts/README.md)
  - [ ] [US-2124: Call gaps: open a folder in its editor, save any page, error codes everywhere](tasks/US-2124-call-gaps/README.md)
  - [ ] [US-2125: Test host value fidelity and call options](tasks/US-2125-test-host-fidelity/README.md)
  - [ ] [US-2126: Guide and `$help` sweep for the open doc entries](tasks/US-2126-guide-help-sweep/README.md)

- **EPIC-200** — [Published boards: bugs and documentation found by the UI test roadmap](epics/EPIC-200.md) — work in `persephone-boards`
  - [ ] [US-2127: Theme Editor: `previewStatus.pending` never settles](tasks/US-2127-theme-editor-preview-status/README.md)
  - [ ] [US-2128: Audio Player: playlist `next()`, light-mode model, `previous()`](tasks/US-2128-audio-player-model/README.md)
  - [ ] [US-2129: PowerPoint Viewer: report parse errors instead of an empty deck](tasks/US-2129-pptx-parse-errors/README.md)
  - [ ] [US-2130: Board docs that disagree with the board](tasks/US-2130-board-doc-fixes/README.md)
  - [ ] [US-2131: Agent guides: result shapes and model coverage](tasks/US-2131-board-agent-guides/README.md)

- **EPIC-201** — [Board data and network isolation](epics/EPIC-201.md) — Persephone + `persephone-boards`
  - [ ] [US-2132: Host: hand a profile-scoped data root to board services](tasks/US-2132-board-data-root/README.md)
  - [ ] [US-2133: Boards use the host data root](tasks/US-2133-boards-use-data-root/README.md)
  - [ ] [US-2134: Network honesty: `network: false` and services](tasks/US-2134-network-honesty/README.md)
  - [ ] [US-2135: Torrent Viewer: offline metadata mode](tasks/US-2135-torrent-offline-inspect/README.md)
  - [ ] [US-2136: Test mode: environment sandbox for board processes](tasks/US-2136-test-board-sandbox/README.md)

## Planned

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
