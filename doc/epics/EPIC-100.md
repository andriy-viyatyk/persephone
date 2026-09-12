# EPIC-100: Move the Force Graph editor out of the app into a board

## Status

**Status:** Active
**Created:** 2026-09-12

## Overview

The built-in Force Graph editor (`graph-view`, `.fg.json`) becomes a **board** in
[`persephone-boards`](https://github.com/andriy-viyatyk/persephone-boards), and is then deleted
from the app. It is the third editor to make this trip: the **Todo** editor went in US-893 /
EPIC-098, the **PDF** viewer in EPIC-047, and this epic follows EPIC-047's task sequence because
Graph is far too large to land in one step.

The prize is the same as before — the app's core gets smaller and faster, `d3` and the graph
editor's share of the bundle leave with it, and the feature keeps shipping on its own cadence
through the board catalog instead of waiting for an app release.

**Full investigation: [EPIC-100-investigation-notes.md](EPIC-100-investigation-notes.md).**
That document's §1.3 is the exhaustive feature inventory and is the **parity checklist** this
epic is verified against; §6 is the file-by-file removal template, derived from the actual Todo
removal commit `a2692189`.

## The premise that did not survive investigation

The epic was proposed on the belief that Graph is "a simple one-file editor with no dependent
functionality". It is not, and the plan is built around the real numbers:

| | Todo (the precedent) | Graph (this epic) |
|---|---|---|
| Built-in size | 2,712 lines, 8 files | **~9,350 lines, 29 files** + a 521-LOC facade + typings |
| Expected board size | 1,350 LOC, one IIFE | **4,000–6,000 LOC** |
| Vendored libraries | none | `d3-force`/`-selection`/`-zoom`/`-drag`, `av-grid` 2.6.1 |
| Rendering | plain DOM | `<canvas>` + a live physics simulation |
| Coupling | modest | **eight** app subsystems (§3) |

What *is* genuinely portable is worth stating, because it is most of the hard logic: the six pure
model classes plus `shapeGeometry` and `ForceGraphRenderer` — **~2,800 of the 8,569 lines** — are
framework-free and move almost verbatim once the colors and the `d3` import style are resolved.
The risk is not the graph algorithms. It is everything the editor borrows from the app shell.

## Goals

- A Force Graph board that passes the §1.3 parity checklist against the built-in editor.
- The object-model gaps that block parity closed in the app, additively, and useful to **every**
  board rather than special-cased for this one.
- No regression for agents: the ~30 facade methods and ~30 named elements survive as an
  AiVision model, reachable at `pages[i].editor.app`.
- The built-in editor deleted only **after** the owner has tested the board.

## Decisions

**D1 — Three object-model gaps are closed in the app, not worked around in the board.**
The board API cannot do three things the editor needs, and in each case the workaround is worse
than the fix. All three are additive and benefit any board:

- **Cross-editor page creation** (§5.7) — five features (Open as markdown, Open in grid, Extract,
  Extract with children, Open in Drawing) create an in-memory page in *another* editor. Boards
  have only `openRawLink(href)`, which needs a `data:` URL that has never been verified and would
  blow up on a large graph. A bridge method is the honest fix.
- **Graph color tokens** (§5.1) — the 14 `--color-graph-*` tokens have no `--p-*` counterpart. A
  canvas cannot read `var(...)`, and deriving a palette from the general set loses per-theme
  fidelity across all 10 themes.
- **Content detection** (§5.15) — the built-in matcher also fires on `"type":"force-graph"` in any
  JSON, which is how agent-generated untitled pages get a Graph switch. `board-manifest.json` has
  only `fileMasks`. Without this the migration is a real behavioral regression.

**D2 — Dialogs and context menus are rebuilt inside the board, not added to the bridge.**
The opposite call to D1, deliberately. ~350 LOC of overlay and submenu code is mechanical, the
boards documentation already prescribes in-frame overlays, and a shell dialog API reachable from
a sandboxed frame is a security surface this epic should not open on the side. The Todo board set
the precedent with its `.confirm-overlay`.

**D3 — EPIC-098's `*Core` split is mandatory for every destructive action.**
An agent-facing method must never block on an in-board confirm overlay: `deleteGroupCore(id)` for
agents, `deleteGroup(id)` for the UI. This is a recorded lesson from the Todo migration, and with
five confirmations (one of them three-button) Graph is where it would hurt most.

**D4 — The two image buttons move into the board's own toolbar.** A board cannot contribute to
Persephone's page toolbar (§5.9). Cosmetic, but it changes the documented layout and the
`elements` contract, so it is a decision and not an accident.

**D5 — The removal degradations of §6.6 are accepted in advance**, matching what EPIC-047 and the
Todo removal already accepted: `.fg.json` falls back to Monaco without the board, `grid-json`
becomes a switch option, persisted `graph-view` tabs are dropped on upgrade, and `page.asGraph()`
is removed with no alias. No compatibility shims.

**D7 — A board carries its own documentation, and US-1405 waits for that.**
The app owns 24 KB of Force Graph documentation (`assets/guides/editors/graph.md`,
`assets/guides/formats/graph.md`, `qa/surfaces/editors/graph.md`). Removing the built-in editor
would delete it, which is precisely what commit `a2692189` did to the Todo editor's guide — **the
Todo board has shipped undocumented ever since**. So boards gain a `guides` manifest folder, mounted
into the existing guide index as a second `GuideSource` under `boards/<id>/` (US-1406), and Force
Graph ships its own pages (BT-019). Docs then version with the board instead of desyncing whenever
it updates independently.

The mechanism is a mount, not an invention: `GuideSource` is already a two-method interface, the
front-matter contract already has `audience` and `editorId`, and the About tree is already built
from path structure — so a top-level installed-boards branch, the agent-guides toggle, `F1`, and
`guides.search()` all follow without new surface. Rejected alternative: putting board docs only in
the AiVision descriptors, which serves agents but not users and cannot carry a format reference.
(Owner decision, 2026-09-12.)

**As implemented (US-1406):** the manifest field is `"guides": "<board-relative folder>"`, and pages
mount at **`installed-boards/<board-folder-name>/<page>`** — not `boards/<id>/`, which would have
collided with the existing top-level `boards.md` authoring page and made the branch unreachable
through `guides.boards`. Only **trusted** boards contribute documentation (a trusted board already
has arbitrary execution, so the mount adds no capability; an untrusted one gets none). A board's own
page claims its board for `F1` with the fixed token `editorId: "board"`, since the real editor id
embeds a machine-specific absolute path. Full reasoning in the task document.

**D6 — Nothing is deleted until the owner has tested the board.** BT-016 is gated on that, by the
owner's explicit instruction: build the board first, test it, then clean up.

## Linked Tasks

App-side tasks are `US-` in this repo; board-side tasks are `BT-` in `persephone-boards`
(working branch `develop` — merging to `main` is the publish trigger).

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1404 | persephone | Board object model: cross-editor page creation, graph color tokens, manifest content detection | **Implemented** (unreviewed) |
| BT-014 | boards | Force Graph board — models, renderer, canvas, content host (v1 spike) | **Implemented** |
| BT-015 | boards | Force Graph board — panels, grids, menus, dialogs, AiVision surface (v2) | **Implemented** |
| BT-016 | boards | Parity verification against the built-in editor, over the §1.3 checklist | **Implemented** |
| US-1405 | persephone | Remove the built-in Force Graph editor | **Blocked — awaiting owner testing of the board** |
| BT-017 | boards | Detail panel resizer — owner-reported defect from hands-on testing | **Fixed** |
| BT-018 | boards | Colored tab icon — owner-reported defect from hands-on testing | **Fixed** |
| US-1406 | persephone | Boards supply their own documentation to the guide system | **Implemented** (unreviewed) |
| BT-019 | boards | Force Graph board — ship its own user and agent documentation | **Implemented** |
| BT-020 | boards | Todo board — backfill the documentation deleted with the built-in editor | Planned |
| BT-021 | boards | Move the `greek-gods.fg.json` example into the board | In Progress |

## The bridge contract (US-1404 ⇄ BT-014/015)

**Implemented and verified in US-1404.** Board shim version **1.5.0**. These are the real
signatures; the sketch this section originally carried was corrected on 2026-09-12 (see Notes).

```js
// 1. Cross-editor page creation. Create-only: returns the id of a page the board just made,
//    never a handle to an existing one. Rejects for an unknown editor or language, a standalone
//    editor, a `board-editor:` id, an untrusted board, or content over 16M chars.
const pageId = await persephone.openContent({ editor, language, title, content });

// 2. Graph palette — concrete color values (a canvas cannot read `var(...)`), redelivered on
//    every onThemeChange. Matching --p-graph-* CSS vars update live on theme switch.
persephone.getTheme().graph
// bg, nodeDefault, nodeHighlight, nodeSelected, nodeSpecial, borderDefault, borderHighlight,
// borderSelected, borderSpecial, linkDefault, linkSelected, labelBg, labelText, groupBorder

// 3. Content detection — a new board-manifest.json field beside fileMasks. Case-insensitive
//    regex sources, tested against the first 64 KB, scoped to switch options.
"contentMasks": ["\"type\"\s*:\s*\"force-graph\""]
```

## Notes

### 2026-09-12
- Epic opened. Investigation (§1–§7) complete and recorded before any implementation.
- The owner's "simple one-file editor" premise was tested and refuted — see the table above. The
  epic is sequenced as a migration, not a port.
- The Todo board is at 1.1.0 / `minAppVersion 5.0.1` in the repo while the published catalog still
  advertises 1.0.2. That is a **pre-existing** open item, unrelated to this epic; do not fold it
  into a Graph publish.
- **US-1404 implemented; bridge is now 1.5.0.** One deviation from the contract above, recorded in
  the task document: `getTheme().graph` carries the **14 semantic tokens** keyed by the camelCased
  CSS suffix (`bg`, `nodeDefault`, `nodeHighlight`, `nodeSelected`, `nodeSpecial`, `borderDefault`,
  `borderHighlight`, `borderSelected`, `borderSpecial`, `linkDefault`, `linkSelected`, `labelBg`,
  `labelText`, `groupBorder`), not the illustrative `node1..node5` categorical palette the snippet
  showed — the snippet contradicted the same decision's own "the 14 tokens". The CSS family is
  `--p-graph-<kebab>`, so the two halves are one contract with a mechanical mapping. Boards must
  declare `"minAppVersion"` accordingly.
- **US-1404 complete.** Shim 1.5.0. `openContent` rides the page-scoped host-frame channel rather
  than the main port, so it inherits the origin/source-frame check and is re-trust-checked per
  request; it adds no read, list, navigate, close or mutate verb, and `persephone.call`'s scoping
  is unchanged. Reviewed at the orchestrator level: scope is additive, `src/renderer/editors/graph/`
  untouched, typecheck / lint / build-prod pass.
- **Contract correction.** The epic originally sketched the palette as `node1..node5`, a
  categorical shape that contradicted D1 and §3.5's "the 14 tokens". The implementation uses the
  14 semantic keys above, which map 1:1 onto the app's `--color-graph-*` set — so the board's
  renderer port lines up with what the built-in editor reads today. The sketch was wrong; the
  implementation is right. The running board agent was corrected mid-flight.
- No JS adapter was added under `boards-assets/`. The `chart-theme.js` / `mermaid-theme.js`
  precedent exists to translate a palette into a third-party library's option object, and there is
  no such library here — the board reads `getTheme().graph` directly.

### 2026-09-12 — board complete, awaiting owner testing

The board is built and verified. **6,114 LOC** across 10 JS modules plus CSS/HTML, with `d3` v7
and `av-grid` 2.6.1 vendored into `lib/`. Board version **1.0.0**, `minAppVersion` 5.0.1,
`editorPriority` 200, `contentMasks` set. Boards repo is on `develop`; **nothing is committed in
either repo.**

**Three defects were found by later stages in work that an earlier stage had already reported as
working** — the reason the parity gate exists as a separate task:

1. The **d3 link force was never installed** (`initializeForces` bails at 0×0, the normal board-frame
   state at load), so the graph drew as an edgeless cloud. Found in BT-015, after BT-014 reported v1
   verified.
2. A **`persephone.state` feedback loop** flipped `groupingEnabled` ~180×/s, re-simulating and
   clearing the selection on every pass. Found in BT-015.
3. The board **docked its entire chrome** — full-width toolbar and panel strip, legend and detail as
   flex columns squeezing the canvas — where the built-in floats a 50%-opacity toolbar card top-left,
   legend bottom-left, detail top-right over a full-bleed canvas. Found in BT-016 and rebuilt to
   match. Two further real defects surfaced with it: the detail grids rendered **only their first
   row** (av-grid's inline `height:100%` never resolving against an auto-height flex parent), and
   Escape left stale text in a focused search box.

**Verified equal to the built-in:** all 14 graph tokens across three themes with live re-delivery;
byte-identical save round-trip including duplicate ids, unknown keys, 4-space JSON and no `_$`/sim
key leakage; all four context menus plus the selection menu; the three detail and three legend tabs;
the Results panel; tooltip; footer counts; Ctrl+F / Ctrl+A / Escape / arrows; 33 element names
identical, with the AiVision model a **superset** of the facade's ~30 members; every destructive
`*Core` path returning without an overlay (D3); and the link force surviving reload,
background-reload-then-show, tab switch and resize. `ui.log` clean throughout.

**Copy Image is verified working** with the window focused — BT-015's "Document is not focused"
failure was the backgrounded app, not the board.

**Accepted differences** (recorded, not defects): the two image buttons live in the board's toolbar
(D4); grouping strikethrough follows §1.3's documented sense rather than the built-in's inverted
`strikethrough: groupingEnabled`; the detail panel resizes by left-edge drag rather than a
south-west corner; `groupingEnabled` is page-scoped rather than host-scoped; native range sliders;
minor tooltip badge styling. `av-grid`'s exported `showMenu` backs the five menus instead of a
hand-rolled implementation — in-frame and vendored, so **D2's reasoning holds**, and submenus,
separators, disabled/invisible items and icons were verified equivalent.

**Not verifiable without a human at the keyboard**, and explicitly NOT claimed as passing: real
pointer gestures (drag, zoom, Alt+click, double-click, hover were all synthetic — two apparent
defects were traced to malformed synthetic events rather than the board), a real Ctrl+S keypress,
and dragging the detail panel's resizer by hand. **These are the first things owner testing should
exercise.**

**US-1405 stays blocked.** Per D6 nothing is deleted until the owner has tested the board, and per
D7 below it must also wait for the documentation to have somewhere to go.

### 2026-09-12 — owner testing, first defect

The owner tested the board and reported the detail panel had no resize indicator and could not be
made larger to read the properties grid. Fixed as **BT-017**.

It is worth recording what this says about BT-016's verdict. BT-016 listed "detail resizes by
left-edge drag not a sw-corner" under *accepted differences* — but the left-edge drag **could not
grow the panel at all**: it clamped against `#detail-slot`, an absolutely-positioned wrapper that
shrink-wraps its content, so the limit evaluated to 90% of the panel's own current width and every
drag could only shrink it. A synthetic-event check confirmed the panel going 260→234px on a
widening drag.

So a difference recorded as cosmetic was concealing a broken control. The lesson for the remaining
verification: **an "accepted difference" in an interactive affordance is only acceptable once the
affordance has been driven and observed to work** — comparing appearance is not enough, and
BT-016's own "not verifiable without a human" list (real pointer gestures) is exactly where this
hid.

### 2026-09-12 — owner testing, second defect

The board's tab icon rendered near-black and was almost invisible in dark mode. `icon.svg` was
drawn with `fill="currentColor"` / `stroke="currentColor"`, but Persephone renders a board icon as
`<img src="file:///.../icon.svg">` — **an SVG loaded as an image inherits no color**, so
`currentColor` resolves to the initial value, black. It never worked on any theme; dark mode is
just where it disappears.

Every other board in the repo already uses explicit brand colors, and the PDF viewer's icon carries
a comment saying exactly why. Force Graph was the outlier. Recolored with fixed hues taken from the
graph palette itself (`#00bfff` default-node blue, `#b07ce8` special-node purple, a slate for the
links), keeping the original geometry.

Verified by rasterizing the icon to a canvas in the app window and counting pixels: the painted
colors are `#29b6f6` / `#1ba1e2` / `#7a93a8` / `#b07ce8` with **zero near-black pixels**.

Worth noting for the remaining board work: a board icon can never use `currentColor`, and neither
a code review nor a screenshot comparison would reliably catch it — the icon is small, and on a
light theme black looks deliberate.

### 2026-09-12 — documentation lands; the example follows it

**US-1406 and BT-019 are implemented.** Boards declare `"guides": "<folder>"` and their pages mount
at `installed-boards/<board>/`, appearing in the About tree, `F1`, `guides.search()` and
`guides["installed-boards/..."]`. Force Graph ships four pages (`index`, `editor`, `format`,
`agent`), rewritten against `pages[i].editor.app` rather than copied from the built-in's
`page.asGraph()` documents.

Three decisions worth keeping:

- **`GuideSource`'s root became a constructor argument**, so containment is per instance. Verified
  both directions: board pages read, while `../board-manifest.json`, `C:/Windows/win.ini` and
  `/etc/passwd` are rejected against the *board's own* root, and a board whose `guides` value
  escapes has its mount dropped entirely.
- **An untrusted board's guides are not shown at all.** Guides render through `MarkdownBlockView`,
  which runs `rehype-raw` with `allowDangerousHtml` in a `nodeIntegration: true` renderer, so rather
  than assume author Markdown is inert, mounting is gated on trust — where a board already has
  arbitrary execution and the mount adds no capability.
- **The mount segment is `installed-boards`, not `boards`**, which would have collided with
  `assets/guides/boards.md` (the *authoring* guide), producing duplicate root rows and an
  unreachable `guides.boards` branch.

**A gap between the two tasks, caught at the seam.** BT-019 omitted `editorId` because a board's
editor id is `board-editor:<absolute root>` — machine-specific and unusable in a shipped guide.
Correct reasoning; but US-1406 had solved exactly that with a `editorId: "board"` token honored only
for pages under that board's own mount, and verified F1 against its own throwaway fixture. So the
real board's pages had no `editorId` and F1 fell back to the generic board guide. Both agents were
individually right and the criterion still nearly lapsed. Closed in BT-019 and verified live.

**BT-021** moves `greek-gods.fg.json` into the board (owner decision): it is the board's example,
not the app's. Notably the file is already **orphaned** in the app — nothing under `assets/`, `qa/`
or `src/` references it. US-1405 deletes the app copy.
