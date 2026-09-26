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
| E — part 1: a board provider feeds Persephone's own editors | [EPIC-113](epics/EPIC-113.md) | **active** — created 2026-09-26; audio-player board dropped by user decision |
| E — part 2: the torrent viewer board | — | not started (EPIC-114, after EPIC-113) |

**[EPIC-111: Board settings](epics/EPIC-111.md)** is not a roadmap phase. It was created from a gap
EPIC-109 uncovered: boards can persist state but the user can neither see nor change it, so the
drawing library path has nowhere to live once `editors/draw` is deleted. EPIC-109 D11 made it a
prerequisite of EPIC-110, which shipped 2026-09-25.

**EPIC-112: Board toolbar controls** shipped 2026-09-21; it moved to
[`epics/completed.md`](epics/completed.md). It cleared the second of EPIC-110's two prerequisites:
the built-in Draw editor's five toolbar controls exist on the bundled Excalidraw board, so
deleting `editors/draw` did not take them with it.

## Active

- **EPIC-113** — [A board provider can feed Persephone's own editors](epics/EPIC-113.md)
  — Phase E part 1. A link a board hands to `openRawLink` opens in the editor its file name
  deserves, and that editor's pipe pulls the bytes back out of the board, a range at a time. No
  board is written here; the torrent board is EPIC-114.
  - [ ] [US-1517: A board-scheme link resolves to the editor its file name deserves, not always
    Monaco](tasks/US-1517-board-scheme-editor-resolution/README.md) — `createBoardSchemeHooks` set
    `data.target ||= "monaco"` before every downstream resolver that would have matched the file
    name. Smallest task, and the user-visible one.
  - [ ] US-1474: Ranged reads pushed into a board-implemented provider (`createReadStream` over the
    module service) — the pre-committed deferral from [EPIC-107](epics/EPIC-107.md) D11, moved here
    from *(no epic)*; this epic is the consumer D11 was waiting for. Ships the
    `persephone-boards/_test/` fixture board (slow, stallable, >256 MB) that makes the epic
    verifiable without EPIC-114.
  - [ ] US-1518: A content read has **no deadline** — it waits until the page closes or the user
    deletes the source. Replaces the fixed 10 s cap with wire-level cancellation, and keeps waiting
    reads out of the 32-slot budget the board's own control requests (including delete) share.
  - [ ] [US-1519: The built-in media player plays from a pipe](tasks/US-1519-media-player-pipe-source/README.md) — a third `video-stream-server` source
    beside local file and HTTP, so the in-page `<video>` **and** Open in VLC both work. Must use the
    127.0.0.1 HTTP surface, not `board://__pipe`: VLC is an external process and cannot fetch a
    custom Electron protocol.
  - [ ] [US-1521: `persephone.content.open(link)` → `{ url, size, contentType }`](tasks/US-1521-content-open-api/README.md) — a ranged,
    origin-local URL for any link, so boards and built-in editors alike stop reading paths
    directly. A new namespace, not an overload of `host.streamUrl()`, which is gated to
    content-host/stream-host boards while every published board is `simple`. Shares its seam with
    US-1519 and lands first.
  - [ ] US-1520: Close the documented gaps — `boards.md` seeking note, roadmap §3.8 and Phase E
    corrections

## Planned

- *(no epic)*
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
