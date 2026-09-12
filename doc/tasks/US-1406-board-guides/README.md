# US-1406: Boards supply their own documentation to the guide system

**Epic:** [EPIC-100](../../epics/EPIC-100.md)

## Goal

Let an installed board ship its own user and agent documentation, and have Persephone surface it
through the existing guide system: the About page's guide tree, `F1`, `guides.search()`, and
`guides["..."]` over MCP. A board's docs then version and ship with the board, instead of living in
the app where they desync the moment the board updates.

## Background

### Why now

EPIC-100 moves the Force Graph editor into a board. The app currently owns its documentation:

- `assets/guides/editors/graph.md` (8.1 KB) — the user guide
- `assets/guides/formats/graph.md` (9.4 KB) — the `.fg.json` format reference
- `qa/surfaces/editors/graph.md` (6.7 KB) — the QA surface

US-1405 deletes the editor. With nowhere for these to go they would be deleted too — which is
exactly what happened to the Todo editor in commit `a2692189` ("the todo MCP guide resource,
read_guide enum entry, and tool-description mentions" were removed). **The Todo board has shipped
undocumented ever since.** This task exists so Force Graph does not repeat that, and so Todo can be
backfilled.

**Sequencing: this must land before US-1405.** Removing the built-in first opens a window where the
feature exists with its documentation already deleted.

### The seam that already exists

The guide system is well factored for this; the work is mounting a second source, not inventing a
mechanism.

| Fact | Where | Why it matters |
|---|---|---|
| `GuideSource` is an interface with exactly two methods — `readDirectory(relativeDirectory)` and `readFile(relativePath)` | `src/shared/guides/index.ts:14` | A board-backed source is a small implementation, not a refactor |
| `MainGuideSource` resolves against one root and throws on escape (`Guide path "..." escapes the guide root.`) | `src/main/mcp/ai-vision/guide-source.ts:52` | Containment must become **per-root**, not global |
| Front-matter keys are fixed: `title`, `audience`, `summary`, `screen`, `editorId` | `src/shared/guides/front-matter.ts:9` | Board pages reuse the contract verbatim — no new schema |
| `audience` is `user` \| `agent` \| `both`; `user`/`agent` each include `both` | `src/shared/guides/index.ts:4` | The About page's existing agent-guides toggle keeps working for board docs |
| `editorId` may be a string or array, and is validated with diagnostics (`annotateEditorIdDiagnostics`) | `src/shared/guides/index.ts:165` | `F1` on a board page can resolve to the board's guide through the existing path |
| The tree is built purely from slash-separated paths (`buildTree`, `src/shared/guides/index.ts:278`) | | Mounting board pages under `boards/<id>/` produces the top-level branch **for free** |
| Board manifest keys today | `boards/*/board-manifest.json` | `schemaVersion, name, description, author, repository, version, minAppVersion, screenshot, fileMasks, contentMasks, editorPriority, editorName, editorKind, secondaryViews` |

## Implementation status

All eight steps implemented and verified live against a real board (Force Graph, at
`C:\projects\persephone-boards\boards\force-graph`) and a throwaway fixture board (the local Demo
board, since removed). Deviations from the plan are recorded under **Decisions taken during
implementation** below.

- [x] 1. Manifest field (`guides`) + validation
- [x] 2. A board guide source (per-root containment)
- [x] 3. Compose sources
- [x] 4. Invalidate on board change
- [x] 5. About tree
- [x] 6. `F1` and editor-id resolution
- [x] 7. MCP / AiVision
- [x] 8. Document the contract for board authors

## Implementation plan

1. **Manifest field.** Add an optional `guides` to `board-manifest.json` — a board-relative folder
   name (default suggestion: `"guides"`). Validate it in `src/renderer/editors/board/board-manifest.ts`
   alongside `contentMasks`: reject absolute paths, `..` segments, and anything escaping the board
   root. Absent field = board contributes no docs (every existing board).
2. **A board guide source.** Implement `GuideSource` over a board's guides folder. Reuse the
   containment logic from `MainGuideSource`, but parameterise the root — do **not** copy the
   `assets/guides` root into it.
3. **Compose sources.** Give `GuideIndex` a set of mounted sources: the built-in root at `""` plus
   one per installed board at `boards/<board-id>/`. `scanDirectory` and `readFile` dispatch on the
   path prefix. Keep enumeration order deterministic (built-in first, then boards by id) so the
   tree and `guides.search()` are stable.
4. **Invalidate on board change.** Installing, updating, untrusting or removing a board must
   re-scan. Find how the board registry signals changes (`custom-editor-registry.ts`) and hook the
   index refresh to it — a stale tree pointing at an uninstalled board is a broken link.
5. **About tree.** The `boards/<id>/` prefix should yield a top-level branch without special-casing.
   Verify against `AboutGuideBrowserView.ts`; give the branch a label distinct from the existing
   top-level `boards.md` authoring guide (that page is about *writing* boards, this branch is about
   *installed* boards — see Concerns).
6. **`F1` and editor-id resolution.** A board page's editor id is `board-editor:<root>`. Decide how
   a board guide's `editorId` front-matter names its own board — most likely the board id, resolved
   against the installed board rather than written as an absolute path, since the path differs per
   machine. Wire it so `F1` on a board page opens that board's guide.
7. **MCP / AiVision.** Confirm `guides.search()` and `guides["boards/force-graph/editor"]` work
   with no change to `src/main/mcp/ai-vision/guides.ts` beyond the index being multi-source. Update
   the guide-resource wiring in `src/main/mcp-http-server.ts` if it enumerates a fixed list.
8. **Document the contract** for board authors in `assets/guides/boards.md` and
   `assets/board-template/CLAUDE.md`, including the front-matter keys and the `audience` split.

## Concerns / open questions

- **Untrusted content.** Board guides are markdown written by a board author, rendered inside
  Persephone's own About page. They must go through the same sanitising path as built-in guides and
  must not gain any capability from being displayed there. Confirm the renderer treats them as data;
  an untrusted board's guides arguably should not be shown at all — decide and record.
- **Naming collision.** `assets/guides/boards.md` (authoring boards) versus a `Boards` branch
  (installed boards' docs). Suggest labelling the branch **"Installed Boards"**, or renaming the
  existing page; do not ship two things called "Boards" side by side.
- **Missing board.** A guide path referencing a board that is no longer installed must fail as a
  clean "not found", not an exception.
- **Path length / collisions.** A board id containing a slash or `..` must never reach a mounted
  path. Validate board ids at mount time, not only at manifest load.
- **Per-root containment.** The single most likely defect in this task: a shared containment check
  that still measures against `assets/guides` would either reject every board page or, worse, allow
  a board page to read outside its folder. Verify both directions explicitly.

## Decisions taken during implementation

### D-a: the mount prefix is `installed-boards/`, not `boards/`

**Deviation from the plan's step 3 and from two acceptance criteria as originally written.** The plan
proposed mounting at `boards/<id>/`, and the Concerns section flagged the naming collision with
`assets/guides/boards.md` in the same breath. Mounting at `boards/` does not just read badly — it
breaks:

- `buildTree` would emit a folder node with `path === "boards"` **and** a page node with
  `path === "boards"` as siblings at the root, so the About tree shows two rows for the same key.
- `GuidesNode.createNode("boards")` probes the entry kind and gets "not a directory" (there is no
  `assets/guides/boards` folder), so it builds a **page** node — making the branch unreachable
  through `guides.boards.<board>` even though `guides["boards/<id>/<page>"]` would still resolve.

Renaming `assets/guides/boards.md` was the other option and was rejected: it is referenced by the
About page's Resources row, by `editorId: "board-info"`, by the MCP server instructions, by the
`persephone://guides/boards` resource and by cross-links in other guides — a wide blast radius for a
cosmetic gain.

So the prefix is `installed-boards`, and the mounted path scheme is
**`installed-boards/<board-folder-name>/<page>`**. Acceptance criteria naming `boards/<id>/…` should
be read as `installed-boards/<id>/…`.

### D-b: the branch label is the path segment, `installed-boards`

The About guide tree labels a folder row with its raw path segment — the existing top-level rows read
`editors`, `screens`, `scripting`, `agents`, `formats`. A title-cased **Installed Boards** would be
the only capitalised folder in the tree. The row therefore reads `installed-boards`, already
unmistakably distinct from the `Boards` **page** beside it, and the breadcrumb trail (which humanises
segments) renders it as **Installed boards**. Verified live: the contents tree shows
`editors | installed-boards | screens | scripting`, and a board page's breadcrumbs read
`Installed boards › Force Graph › Using the Force Graph board`.

### D-c: only TRUSTED boards contribute guides; an untrusted board's guides are not shown at all

The Concerns section asked for a decision and a record. **An untrusted board contributes no
documentation.**

The reasoning is about capability, not taste. Board guides are Markdown authored by the board's
author and rendered by `MarkdownBlockView` — the same pipeline every Markdown file in the app uses —
and that pipeline runs `remark-rehype` with `allowDangerousHtml: true` plus `rehype-raw`, so raw HTML
in a guide reaches the DOM. Event-handler attributes are stripped in `hast-dom.ts`, but the renderer
runs with `nodeIntegration: true`, so treating author-supplied Markdown as fully inert is an
assumption this task has no business making.

Gating on trust makes the question moot rather than answering it optimistically: a **trusted** board
already runs arbitrary code through `persephone.execute`, so mounting its documentation adds no
capability it did not already have; an **untrusted** board gets none, exactly as it gets no editor
association, no rendering and no execute channel. This matches the existing registry precedent
(EPIC-042 CE3), where untrusting flips a board's contributions off live.

Board guides gain **nothing** from being displayed in About: they travel the same
`createGuideIndex` → `GuidePage.content` → `MarkdownBodyModel` path as a built-in page, with the same
front-matter contract, the same audience filter and the same link handling. There is no
board-specific rendering branch anywhere.

### D-d: `editorId: "board"` is the self-reference token for `F1`

A board's real editor id is `board-editor:<absolute board root>` (or `board-view`), which differs on
every machine and can never be written into a shipped guide. A board's own page therefore claims its
board with the fixed token `editorId: "board"`, honoured **only** for pages under that board's own
mount. `openActiveGuideOrContents` reads the active editor's `boardRoot`, maps it to the mount id,
and ranks a self-claim above a generic built-in match — so `F1` on a board page opens the board's own
guide rather than `editors/board`.

Pre-existing behaviour worth noting, unchanged here: a board acting as a **custom editor**
(`board-editor:<root>`) never matched `editors/board`, whose front matter claims `board-view` only.
Such a page now reaches documentation for the first time, through its board's own `editorId: "board"`
page. The Force Graph board's pages do not yet declare that token; BT-019 should add it to
`guides/editor.md`.

### D-e: mount ids are board folder names, deduplicated

The mount id is the board root's **basename**, with anything outside `[A-Za-z0-9._-]` folded to `-`;
a board whose name yields nothing usable is skipped. Roots are enumerated in a stable sort order and
duplicate ids get a `-2`, `-3` suffix, so the tree and `guides.search()` stay deterministic. A mount
id can never contain `/` or `..` by construction — the "validate board ids at mount time" the
Concerns section asked for.

## Verification

Verified live in the running app (Persephone 5.0.2, dev build) with the Force Graph board and a
throwaway fixture board (the local Demo board, given a temporary `guides/` folder plus a nested
agent-audience page, both removed afterwards):

| Check | Result |
|---|---|
| Top-level branch in the About tree | `editors \| installed-boards \| screens \| scripting` — one branch, no collision with the `Boards` page |
| MCP tree | `guides["installed-boards"]` lists `Demo` and `force-graph` with their nested folders and pages |
| MCP page read | `guides["installed-boards/force-graph/index"]` returns the front-matter-stripped body |
| MCP search | `guides.search("quokka sentinel")` returns the fixture page with working `call` and `open` values |
| About rendering | `pages["about-page"].editor.open("installed-boards/force-graph/editor")` renders the board's page; breadcrumbs `Installed boards › Force Graph › Using the Force Graph board` |
| Audience filter | `getTree("user")` omits both agent pages; `getTree("all")` includes them — the *Show agent guides* toggle drives it exactly as for built-in pages |
| `F1` on a board page | Opens the board's own `editorId: "board"` page (`Installed boards › Demo board`), outranking the generic `editors/board` guide |
| Containment — a board page cannot escape | `readFile` on `../board-manifest.json`, `../../Persephone/board-manifest.json`, `C:/Windows/win.ini`, `/etc/passwd` and `..\board-manifest.json` all rejected against the **board's own** root |
| Containment — board pages ARE reachable | The same source reads `index.md` inside the board: the per-root check does not reject every board page, the failure mode the task warned about |
| Manifest escape | `"guides": "../../../../assets/guides"` and `"guides": "C:/projects/persephone/assets/guides"` each drop the mount entirely |
| Removal without restart | Deleting the fixture's `guides/` folder and manifest field removed its pages from the renderer tree within the mount TTL, no restart |
| Boards with no `guides` field | Unchanged — 27 trusted boards, only the two declaring `guides` are mounted |
| `npm run typecheck` / `npm run lint` / `npm run build-prod` | All pass |

Not exercised live: two boards whose folders share a name (the `-2` suffix path in `uniqueMountId`).

## Files changed

| File | Change |
|---|---|
| `src/shared/guides/mounted-source.ts` | **New.** Mount prefix and self-editor-id constants, `normalizeBoardGuidesFolder`, mount-id derivation/dedupe, and `createMountedGuideSource` — routes a path to the root corpus or to one board mount, synthesises the `installed-boards` virtual folders, and answers the sync entry-kind probe |
| `src/main/mcp/ai-vision/guide-source.ts` | `MainGuideSource` takes an optional root; containment is measured **per instance** rather than always against `assets/guides` |
| `src/main/mcp/ai-vision/board-guide-mounts.ts` | **New.** Main-process mount resolver: reads `trustedBoards.txt` and each board's manifest, mounts one `MainGuideSource` per board guides folder, 1 s cache |
| `src/main/mcp/ai-vision/main-root.ts` | The MCP `guides` node is built over the mounted source |
| `src/main/mcp/ai-vision/guides.ts` | Depends on `GuideEntryKindProbe` instead of the concrete `MainGuideSource` |
| `src/main/mcp/server-factory.ts` | The per-session guide index (backing `persephone://guides/full`) is built over the mounted source |
| `src/renderer/guides/guide-source.ts` | `RendererGuideSource` takes an optional root; same per-instance containment |
| `src/renderer/guides/board-guide-mounts.ts` | **New.** Renderer mount resolver: trusted boards + manifests, invalidated by `boardTrust.subscribePaths` plus a 2 s TTL; exports `getBoardGuideMountId` for `F1` |
| `src/renderer/guides/index.ts` | The single renderer guide index is built over the mounted source |
| `src/renderer/editors/board/board-manifest.ts` | Documented `guides?: string` on `BoardManifest`; re-exports `normalizeBoardGuidesFolder` from the shared module |
| `src/renderer/api/internal/KeyboardService.ts` | `F1` resolves the active page's board root to a mount id and honours the `editorId: "board"` self-token, ranked above a generic built-in match |
| `assets/guides/boards.md` | New section: *A board's own documentation — the `guides` folder* |
| `assets/guides/agents/boards.md` | `guides` bullet in *Manifest, icon, reload* |
| `assets/board-template/CLAUDE.md` | `guides` in the manifest section plus a *Ship your own documentation* section |

Files that needed **no** change: `src/shared/guides/index.ts` (the tree, audience filter and search
are source-agnostic already), `src/shared/guides/front-matter.ts` (contract reused verbatim),
`src/main/mcp/manifest.ts` (`resourceFiles` is a fixed app-corpus list), the About views
(`AboutGuideBrowserView.ts` / `AboutGuidePageView.ts` — the branch appears purely from path
structure), and everything under `src/renderer/editors/graph/` (US-1405's scope). Nothing in the
`persephone-boards` repository was modified.

## Acceptance criteria

- [x] A board with a `guides` folder appears as its own branch in the About guide tree, nested under
  the single top-level `installed-boards` node (see D-a).
- [x] `guides.search("...")` returns hits from board guides, with a working `call` path and `open` URL.
- [x] `guides["installed-boards/<id>/<page>"]` resolves over MCP and returns the page (path scheme per D-a).
- [x] The `audience` filter hides board agent-guides behind the existing toggle, exactly as for
  built-in pages.
- [x] `F1` on a board page opens that board's guide when one is declared (`editorId: "board"`, D-d).
- [x] Uninstalling a board removes its pages from the tree and search without an app restart.
- [x] A board guide cannot read a file outside its own guides folder.
- [x] Boards with no `guides` field behave exactly as today.
- [x] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.
