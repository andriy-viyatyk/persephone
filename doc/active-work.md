# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [platform roadmap](platform-roadmap.md) (phases A–F, EPIC-105 to EPIC-114) finished on
2026-09-27; its epics are in [`epics/completed.md`](epics/completed.md).

## Active

- **EPIC-115** — [Platform roadmap clean-up — fix what the adjustment rounds left behind](epics/EPIC-115.md)
  - *Phase 1 — defects*
  - [x] [US-1534: Capability handler pages open for any trusted board, not only bundled ones](tasks/US-1534-capability-handler-open/README.md)
  - [x] [US-1535: One service renderer lease per window, not per service](tasks/US-1535-service-lease-per-window/README.md)
  - [x] [US-1536: Board `ui.log` — one main-owned writer; no truncation; bundled boards log to userData](tasks/US-1536-board-log-writer/README.md)
  - [x] [US-1537: Launch arguments parsed once; a cold-start URL takes the same route as a running-instance URL](tasks/US-1537-launch-arguments/README.md)
  - [x] [US-1538: Main owns the board trust and URL-mask snapshots](tasks/US-1538-main-owned-trust-snapshot/README.md)
  - [x] [US-1547: Remove the unreachable board-provider acquire path; a recovered pipe regains ranged reads](tasks/US-1547-board-provider-acquire/README.md)
  - [x] [US-1556: Board Info pages are dropped on restore](tasks/US-1556-board-page-restore/README.md)
  - *Phase 2 — contracts with one definition*
  - [x] [US-1539: Capability contract single-sourced — error codes, intent envelope, outcome shape](tasks/US-1539-capability-contract/README.md)
  - [x] [US-1540: One owner for a capability request's lifecycle](tasks/US-1540-capability-request-lifecycle/README.md)
  - [x] [US-1541: Built-in capability resolution runs the handler it resolved; one image-edit helper](tasks/US-1541-builtin-capability-resolution/README.md)
  - [x] [US-1542: Host-frame request/reply channel — one table on each side, typed message union](tasks/US-1542-host-frame-channel/README.md)
  - [x] [US-1543: The service host owns the service lifecycle protocol](tasks/US-1543-service-lifecycle-protocol/README.md)
  - [x] [US-1544: One provider-operation policy table (deadline, cap)](tasks/US-1544-provider-operation-policy/README.md)
  - *Phase 3 — structure*
  - [x] [US-1545: Split the module-service supervisor; one state-transition helper](tasks/US-1545-supervisor-split/README.md)
  - [x] [US-1546: One `__pipe` range reader in main; one MIME table](tasks/US-1546-pipe-range-reader/README.md)
  - [x] [US-1548: One ownership registry for providers, schemes, capabilities and URL masks](tasks/US-1548-ownership-registry/README.md)
  - [x] [US-1549: Board manifest parsed once into a normalized model](tasks/US-1549-normalized-board-manifest/README.md)
  - [x] [US-1550: Scheme hooks — a `handoff()` helper and shared URL helpers](tasks/US-1550-scheme-hooks-handoff/README.md)
  - [x] [US-1551: Single-instance board routing in one place; a typed open-context hook](tasks/US-1551-single-instance-routing/README.md)
  - [x] [US-1552: Video pipe sessions use the `resource` pipe kind; delete the page-owner waiters](tasks/US-1552-video-resource-pipe/README.md)
  - [x] [US-1553: VideoEditor's source flow in one place; one provider-recovery helper](tasks/US-1553-video-source-flow/README.md)
  - [x] [US-1554: Board trust granting, bundled-board creation and Board Info each have one path](tasks/US-1554-board-trust-bundled-info-paths/README.md)
  - [x] [US-1555: Small dead code, stale comments and a torrent-specific notice in core](tasks/US-1555-small-cleanups/README.md)
  - *Phase 4 — deprecated API removal*
  - [x] [US-1558: Remove the deprecated `boards.openBoard({ intent })` API and `ILinkData.intent`](tasks/US-1558-remove-openboard-intent/README.md)

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
