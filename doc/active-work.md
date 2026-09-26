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
| B — Bridge contract and module service process | [EPIC-106](epics/EPIC-106.md) | **shipped 2026-09-20** |
| C — Open providers with ranged streaming | [EPIC-107](epics/EPIC-107.md) | **shipped 2026-09-20** (US-1474 deferred to Phase E) |
| D — Capability bus and in-memory data channel | [EPIC-108](epics/EPIC-108.md) | **shipped 2026-09-20** (DataHandle store deferred to Phase F) |
| F — Excalidraw extraction, part 1: bundled boards + the board | [EPIC-109](epics/EPIC-109.md) | **shipped 2026-09-23** |
| F — Excalidraw extraction, part 2: remove `editors/draw` and React | [EPIC-110](epics/EPIC-110.md) | **shipped 2026-09-25** — React left the renderer bundle (−10.4%); packages moved to `devDependencies` rather than removed |
| E — part 1: a board provider feeds Persephone's own editors | [EPIC-113](epics/EPIC-113.md) | **shipped 2026-09-26** — audio-player board dropped by user decision (D2); all nine acceptance items verified in the running app, VLC included |
| E — part 2: the torrent viewer board | [EPIC-114](epics/EPIC-114.md) | **in progress** |

**[EPIC-111: Board settings](epics/EPIC-111.md)** is not a roadmap phase. It was created from a gap
EPIC-109 uncovered: boards can persist state but the user can neither see nor change it, so the
drawing library path has nowhere to live once `editors/draw` is deleted. EPIC-109 D11 made it a
prerequisite of EPIC-110, which shipped 2026-09-25.

**EPIC-112: Board toolbar controls** shipped 2026-09-21; it moved to
[`epics/completed.md`](epics/completed.md). It cleared the second of EPIC-110's two prerequisites:
the built-in Draw editor's five toolbar controls exist on the bundled Excalidraw board, so
deleting `editors/draw` did not take them with it.

## Active

- **EPIC-114** — [The torrent board — a module contributes below the UI](epics/EPIC-114.md)
  - [ ] US-1523: The board skeleton: manifest, vendored WebTorrent bundle, and a service that resolves a magnet to metadata
  - [ ] US-1524: The `torrent` content provider: `stat` + `readRange` + `readBinary`, the self-contained link, piece prioritisation
  - [ ] US-1525: The board page: torrent list, file list, double-click → `openRawLink`, Download-this-file
  - [ ] US-1526: Lifecycle: page close stops the stream, cold-start restore with no board page, service stop, uninstall placeholder
  - [ ] [US-1478: Route a downloaded `.torrent` (and other board-claimed downloads) into `openRawLink`](tasks/US-1476-browser-scheme-routing/README.md)
    — moved under EPIC-114 from *(no epic)*; it is the `.torrent` half of the board's entry points (D10).
    A download takes `will-download` in `src/main/download-service.ts` and is opened with `shell.openPath`,
    so it never reaches the content pipeline. Needs a product decision plus download-manager lifecycle work.
  - [ ] US-1527: Documentation: roadmap §3.8 + Phase E corrections, `boards.md`, the board's own guides

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
