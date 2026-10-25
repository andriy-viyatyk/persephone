# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-131** — [Agent sessions in boards — provider boards and a multi-agent team chat](epics/EPIC-131.md)
  - [ ] [US-1703: Phase 0 — service channels (page ↔ own service, long-lived, streaming)](tasks/US-1703-service-channels/README.md)
  - [ ] [US-1704: Phase 0 — cross-board service interfaces with trust disclosure](tasks/US-1704-cross-board-service-interfaces/README.md)
  - [ ] [US-1709: Phase 0 — private Persephone MCP endpoint for in-app agents](tasks/US-1709-private-agent-mcp-endpoint/README.md)
  - [ ] [US-1710: Phase 0 — multi-line board settings](tasks/US-1710-multiline-board-settings/README.md)
  - [ ] [US-1711: Board settings from a module service](tasks/US-1711-service-board-settings/README.md)
  - [ ] [US-1705: Phase 1 — `agent.session` v1 contract](tasks/US-1705-agent-session-contract/README.md)
  - [ ] US-1706: Phase 1 — `claude-agent` provider board (persephone-boards [BT-046](https://github.com/andriy-viyatyk/persephone-boards/blob/develop/doc/tasks/BT-046-claude-agent-board/README.md))
  - [ ] US-1716: Board footer chip variant (`variant: "chip"` on status-bar text items, bridge 1.42.0) for the `claude-agent` footer
  - [ ] US-1707: Phase 1 — Codex engine in the agent board (persephone-boards BT-048 adapter refactor → BT-049 Codex adapter → BT-050 rename)
  - [ ] US-1708: Phase 2 — group chat in Agent Chat (roles, invited agents, `post_message`, shared delivery)
- *(no epic)*
  - [ ] US-1722: Board page tab keeps an old manifest name after the board is renamed (fixed in `BoardEditorModel.applyManifestTitle`, `manifestTitle` state)

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
