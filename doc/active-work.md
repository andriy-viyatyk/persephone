# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

The [platform roadmap](platform-roadmap.md) (phases A–F, EPIC-105 to EPIC-114) finished on
2026-09-27; its epics are in [`epics/completed.md`](epics/completed.md).

## Active

- **EPIC-118** — [Security hardening — hostile web pages and files](epics/EPIC-118.md)
  - [ ] [US-1587: Sanitize Markdown HTML; Mermaid strict mode](tasks/US-1587-markdown-html-sanitize/README.md) *(Critical)*
  - [ ] [US-1588: DNS-rebinding and Origin protection for the Persephone and Mneme MCP servers](tasks/US-1588-mcp-rebinding-origin/README.md) *(High)*
  - [ ] [US-1589: Web pages cannot open internal Persephone schemes](tasks/US-1589-page-internal-scheme-gate/README.md) *(Medium)*
  - [ ] US-1590: Main-window CSP hardening; investigate `webSecurity: false`
  - [ ] US-1591: Electron fuses + asar integrity; move board Node scripts off `ELECTRON_RUN_AS_NODE`
  - [ ] US-1592: Mark-of-the-Web on browser downloads
  - [ ] US-1593: Least-privilege viewer boards (no `execute()`, stricter CSP)
  - [ ] US-1594: IPC sender checks and popup navigation guard

## Planned

- [ ] [US-1585: Code signing via SignPath Foundation](tasks/US-1585-code-signing-signpath/README.md) — *on hold: awaiting SignPath Foundation review (applied 2026-10-01)*

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
