# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-099** — [The agent event channel — what changed since the agent last looked](epics/EPIC-099.md)
  - [ ] [US-1396: `ai-vision@1.1.0` — EventLog, `ICallResult.events`, proxy `revalidate`, remote `version`/`notify`, overlay buttons](tasks/US-1396-ai-vision-1-1-0/README.md)
  - [ ] [US-1397: The event log, its producers, the per-session cursor, and the `events` block](tasks/US-1397-event-log-and-delivery/README.md)
  - [ ] [US-1398: Browser-page shape signal — lazy revalidation and CDP `Runtime.addBinding`](tasks/US-1398-browser-shape-signal/README.md)
  - [ ] [US-1399: `ui.guide.step` / `ui.guide.end`, and a board's `notify` over the shim](tasks/US-1399-ui-guide-and-notify/README.md)
  - [ ] [US-1400: Guides, What's New, and the EPIC-099 gate](tasks/US-1400-epic-099-guides-and-gate/README.md)

## Planned

- *(no epic)*
  - [ ] [US-1401: Git Tree — the Commit and Diff panels stay empty when a commit is selected](tasks/US-1401-gittree-commit-panels-empty/README.md)
    — user-reported bug, queued to run right after EPIC-099 completes.
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
