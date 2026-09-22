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
| F — Excalidraw extraction, part 1: bundled boards + the board | [EPIC-109](epics/EPIC-109.md) | **active** |
| F — Excalidraw extraction, part 2: remove `editors/draw` and React | — | not started (EPIC-110) — **blocked by EPIC-111** (EPIC-112 shipped 2026-09-21) |
| E — Torrent board and audio player (proof 1) | — | not started |

**[EPIC-111: Board settings](epics/EPIC-111.md)** is not a roadmap phase. It was created from a gap
EPIC-109 uncovered: boards can persist state but the user can neither see nor change it, so the
drawing library path has nowhere to live once `editors/draw` is deleted. EPIC-109 D11 makes it a
prerequisite of EPIC-110.

**EPIC-112: Board toolbar controls** shipped 2026-09-21 and is no longer a blocker; it moved to
[`epics/completed.md`](epics/completed.md). It cleared the second of EPIC-110's two prerequisites:
the built-in Draw editor's five toolbar controls now exist on the bundled Excalidraw board, so
deleting `editors/draw` no longer takes them with it.

## Active

- **[EPIC-109: Bundled boards and the Excalidraw board](epics/EPIC-109.md)** — Phase F part 1.
  Boards that ship inside the installer, registered because they are part of the app and presented
  as built-in editors with a Disable action. The built-in `draw-view` stays as a fallback for the
  whole epic; its removal is EPIC-110.
  - [ ] [US-1483: Bundled board registry and discovery](tasks/US-1483-bundled-board-registry/README.md)
  - [ ] [US-1484: Stable identity for bundled boards across install paths](tasks/US-1484-bundled-board-identity/README.md)
  - [ ] [US-1485: Built-in tab presentation and the Disable action](tasks/US-1485-bundled-board-disable/README.md)
  - [ ] [US-1486: The board's prebuilt lib/, generated once and committed](tasks/US-1486-board-prebuilt-lib/README.md)
  - [ ] [US-1487: The Excalidraw board](tasks/US-1487-excalidraw-board/README.md)
  - [ ] [US-1488: Capability routing into the board, and the payload measurement](tasks/US-1488-excalidraw-capability-routing/README.md)
  - [ ] [US-1489: Board navigation return URLs](tasks/US-1489-board-navigation-return/README.md)
  - [ ] [US-1490: The Excalidraw board's library flow](tasks/US-1490-excalidraw-library/README.md)

## Planned

- **[EPIC-111: Board settings](epics/EPIC-111.md)** — a board declares settings in its manifest and
  Persephone renders them as a sub-page of its own Settings, storing values in the board's scoped
  storage. Created from a user observation while planning EPIC-109's library flow: boards have
  `persephone.storage` but nothing the user can see or edit, so `drawing.library-path` would be
  orphaned when `editors/draw` is removed. **Prerequisite of EPIC-110** (EPIC-109 D11). Open
  decisions — the trust gate, migrating the existing library path, and how narrow the type system
  should start — are recorded in the epic and are resolved before any task document is written.

- *(no epic)*
  - [ ] US-1474: Credit-based ranged streaming into a board-implemented provider
    — deferred out of [EPIC-107](epics/EPIC-107.md) by decision D11, its pre-committed abort
    boundary. `ProxyProvider` serves whole-resource reads and `stream-host` serves ranged reads from
    any platform-owned pipe, but a range is not yet pushed **down** into a board provider — which is
    what lets a torrent client prioritise pieces (roadmap §3.8 step 7). **Belongs to Phase E**, its
    only consumer; the seam is in place (`IProvider.createReadStream?(range)` left unimplemented,
    `ContentPipe` falls back to a buffered read).
  - [ ] US-1478: Route a downloaded `.torrent` (and other board-claimed downloads) into `openRawLink`
    — split out of [US-1476](tasks/US-1476-browser-scheme-routing/README.md) during review. A download
    takes `will-download` in `src/main/download-service.ts` and is opened with `shell.openPath`, so it
    never reaches the content pipeline. Routing it needs a product decision (cancel the download and
    open the source URL, or save first and hand the saved path to `openRawLink`) plus download-manager
    lifecycle work — larger than the navigation fix US-1476 owned. **Not part of EPIC-107.**
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
