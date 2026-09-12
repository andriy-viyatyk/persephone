# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- *(no epic)*
  - [ ] US-1407: "Delete board" leaves an empty folder behind (ENOTEMPTY on Windows)
    — user-reported. `fs.removeDir` now retries (a child still held open is only marked
    for deletion on Windows, so the final `rmdir` fails), and both delete paths take the
    board off its open pages first. `ensureBoardIdle` detaches and disposes the board editor
    instead of closing the page, so the tab stays open and goes empty (user request).
  - [ ] [US-1408: AiVision cannot see or act on a page with no main editor](tasks/US-1408-ai-vision-empty-pages/README.md)
    — user-reported gap found while verifying US-1407: an editorless page renders as a real
    "Empty" tab, but `PageCollectionWrapper.all` filters it out, so the agent cannot see it,
    `pages.activePage` is null while it is active, and `pages.closePage` refuses its id.
  - [ ] US-1409: host menus stay open on a click inside a board
    — user-reported. The board shim has posted `board:interact` on every capture-phase
    pointerdown since US-773, but the host handler still dispatched a `mousedown`, which
    PopoverView stopped listening for. US-1286 converted the browser guest and the HTML
    iframe to `dismissOverlays()` and missed the board — and a second stale dispatch on the
    browser webview's `focus`. Both now go through the shared helper.

## Planned

- *(no epic)*
  - [ ] [US-1131: Close the remaining gaps in the VanillaView lifecycle lint rules](tasks/US-1131-vanillaview-lint-gaps/README.md)
    — tooling, not a defect: the guard itself shipped as US-1142 in EPIC-071 and this is the
    residue. Deferred by user decision (2026-08-29). It carries **five** clause candidates,
    two with measured baselines — clause 3's 77-site sweep showing "not retained" is the wrong
    detector, and clause 5's 0-vs-95 precision measurement — so it gets cheaper to land as the
    evidence accumulates, but nothing depends on it.

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
