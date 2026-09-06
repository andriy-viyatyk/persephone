# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-091** — [`call` surface hardening — acting on the external MCP evaluation](epics/EPIC-091.md)
  — the first outside audit of what the transparency roadmap built. Its
  [source report](epics/EPIC-091-evaluation-report.md) is preserved beside the epic; all sixteen of
  its claims reproduced live before any fix.
  - [ ] [US-1354: Guard `logView.push` against a non-array argument](tasks/US-1354-logview-push-guard/README.md)
  - [ ] [US-1355: Hint economics — honour `hints` and dedupe on the error path](tasks/US-1355-error-hint-economics/README.md)
  - [ ] [US-1356: Extract the argument validator and end the silent no-op class](tasks/US-1356-uniform-arg-validation/README.md)
  - [ ] [US-1357: `call` parameter bounds — `limit`, `maxLength`, `windowIndex`](tasks/US-1357-call-parameter-bounds/README.md)
  - [ ] [US-1358: Language validation, returned-object identity, and grid row keys](tasks/US-1358-language-and-identity/README.md)
  - [ ] [US-1359: Surface documentation and consistency](tasks/US-1359-surface-documentation/README.md)
  - [ ] [US-1360: Malformed-input acceptance run and regression suite](tasks/US-1360-malformed-input-acceptance/README.md)

## Planned

- *(no epic)*
  - [ ] [US-1050: `tools.unregisterToolset(root)` on the object model](tasks/US-1050-unregister-toolset-tool/README.md)
    — an enhancement, deferred by user decision (2026-08-29), **re-scoped 2026-09-07**: the manifest
    is `call` alone since US-1353, so this is now an object-model member mirroring
    `boards.unregisterBoard(boardRoot)` over the existing `toolsTrust.untrust(root)` — not a
    thirty-fifth MCP tool. No confirmation dialog: it reduces privilege rather than granting it.
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
