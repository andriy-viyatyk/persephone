# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-214** — [Linux desktop integration (multiplatform phase 2)](epics/EPIC-214.md)
  - [ ] [US-2211: VM and desktop checklist](tasks/US-2211-linux-vm-and-checklist/README.md)
  - [ ] [US-2212: Wayland or XWayland](tasks/US-2212-wayland-or-xwayland/README.md)
  - [ ] [US-2213: Window chrome, tray and close-to-tray](tasks/US-2213-linux-window-and-tray/README.md)
  - [ ] [US-2214: Single instance, file handoff and profiles](tasks/US-2214-linux-single-instance/README.md)
  - [ ] [US-2215: Terminal, VLC and Tor](tasks/US-2215-terminal-vlc-tor/README.md)
  - [ ] US-2216: Default browser and board shortcuts
  - [ ] US-2217: File clipboard, drag and drop, clipboard history
  - [ ] US-2218: Notifications, theme, lock and virtual desktops
  - [ ] US-2219: GNOME checks carried over from EPIC-213
  - [ ] US-2220: Phase 2 exit run
  - [ ] US-2221: Hide the Windows website sign-in option on Linux (Browser Profiles shows `settings.windowsSsoExplanation`; gate the checkbox and help in `BrowserProfilesSection.ts` on the existing `browser.windowsSso` platform feature)

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
