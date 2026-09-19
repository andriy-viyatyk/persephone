# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active roadmap

**[Platform roadmap](platform-roadmap.md)** — Persephone as a host and registry for boards
(user decision, 2026-09-19). It is implemented **one epic at a time, not all at once**:

1. Take the next phase of the roadmap that has no epic yet (phases are in dependency order, A–F).
2. Decide the epic's scope from that phase — a phase may become one epic or be split if it is too
   large — and create the epic document in `epics/`, listed under **Active** below.
3. Implement and close the epic per the normal workflow (review, docs, move to
   `epics/completed.md`).
4. Only then create the epic for the next phase, until every phase is done.

Update the roadmap's phase notes when an epic changes a decision recorded there. The phase list
below tracks which phases have shipped.

| Phase | Epic | Status |
|---|---|---|
| A — Refactor the seams | [EPIC-105](epics/EPIC-105.md) | **shipped 2026-09-20** |
| B — Bridge contract and module service process | — | not started |
| C — Open providers with ranged streaming | — | not started |
| D — Capability bus and in-memory data channel | — | not started |
| E — Torrent board and audio player (proof 1) | — | not started |
| F — Excalidraw extraction (proof 2) | — | not started |

## Active

*(no active epic)*

## Planned

- *(no epic)*
  - [ ] [US-1463: Cold start drops a file or URL passed on the command line](tasks/US-1463-cold-start-file-open/README.md)
    — found while planning [EPIC-105](epics/EPIC-105.md). `getFileToOpen()` consumes the argument
    before returning it and `EventChannel` has no replay, so the `openRawLink` fired during
    `pages.init()` reaches no subscriber. **Diagnosed from code reading only** — confirm the
    runtime reproduction in the task document before fixing.
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
