# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-139** — [Voice assistant — talk to an agent by name](epics/EPIC-139.md)
  - [ ] [US-1783: Research: wake-word engine and the microphone-plus-loopback rule](tasks/US-1783-wake-word-research/README.md)
  - [ ] [US-1789: Research: local text-to-speech model and voices (English, Ukrainian)](tasks/US-1789-tts-research/README.md)
  - [ ] [US-1784: Reserve `speech.synthesize` and `speech.wake` and publish v1 contract guides](tasks/US-1784-speech-interfaces/README.md)
  - [ ] BT-082: Text to Speech board — `speech.synthesize` provider (persephone-boards)
  - [ ] BT-083: Wake Word board — `speech.wake` provider: enrollment, template matching, stop words (persephone-boards)
  - [ ] [US-1785: `agent.session@1` host service channel and app-side session client](tasks/US-1785-agent-session-host/README.md)
  - [ ] [US-1786: Voice assistant core in the app — superseded, removed by US-1790](tasks/US-1786-voice-assistant-core/README.md)
  - [ ] [US-1787: Agent turn wiring in the app — superseded (planned only)](tasks/US-1787-voice-agent-turn/README.md)
  - [ ] US-1788: TV polish in the app — superseded
  - [ ] US-1790: Audio service: hidden capture window, shared clock, playback, the `audio` capability, `computerAudio` permission; remove the US-1786 core
  - [ ] BT-084: Text to Speech — play through the audio service; `speak` / `stop` operations (persephone-boards)
  - [ ] BT-085: Wake Word — audio service capture, phrase filter, consumer-named phrases, film suppression (persephone-boards)
  - [ ] BT-086: Agent Chat — Wake mode, wake session, Wake words page, listening flow, interrupts (persephone-boards)

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
