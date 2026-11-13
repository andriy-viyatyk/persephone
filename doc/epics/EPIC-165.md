# EPIC-165: Refactoring Phase 6.4 part 3 — editor framework: panel views without IO, `ExplorerEditor` split, `TreeProviderHost`

## Status

**Status:** Completed
**Created:** 2026-11-13

## Overview

This is the twenty-fifth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the third and last part of
roadmap item **6.4, Editor framework**. Part 1 ([EPIC-163](EPIC-163.md)) landed the framework core in `editors/base/`;
part 2 ([EPIC-164](EPIC-164.md)) the per-editor internals (source watching, `VideoStreamSession`, image actions,
`TextEditorPageView`, grid codecs). This epic takes the sidebar-panel cluster recorded as part 3: **EDC-9** (panel
views without IO), **EDC-10** (`ExplorerEditor` split into panel editors) and **EDC-11** (`TreeProviderHost`) from
`doc/reviews/refactoring-2026-11/07-editors-core.md`.

The code was checked on 2026-11-13, after EPIC-164. Line numbers in the report have drifted; the current state:

- **`editors/explorer/`** holds `ExplorerEditorModel.ts` (416 lines), `ExplorerSecondaryView.ts` (421),
  `ClipboardSecondaryView.ts` (705, no model, calls the clipboard IPC itself), `BoardsSecondaryView.ts` (460, performs
  create/delete board and untrust-toolset itself), `SearchSecondaryView.ts` (150) and `page-explorer.ts` (87).
- **One model, four panels.** `ExplorerEditorModel` drives Explorer, Search, Boards and Clipboard panels from the
  persisted flags `boardsOpen`, `clipboardOpen` and `hideExplorer` (set by `api/pages/standalone-pages.ts` for the
  dedicated Clipboard page).
- **Provider ownership.** `ExplorerSecondaryView` creates `new FileTreeProvider(rootPath)` and writes it into the model;
  Archive creates its provider in the model; Link has a lazy getter. Category finds hosts with `instanceof` over three
  editor classes.
- **Other view-side IO.** `CommitDiffPanel` loads commits in the view; Markdown link following lives in
  `MarkdownBodyView` while `navigateBack` lives in `MarkdownEditor`; five models keep raw DOM/widget handles for
  facades (Markdown container, HTML capture element, Video media element, `ScriptPanelModel.editorRef`, Grid `_grid`).

## Goals

- **`ClipboardHistoryModel`** (`api/clipboard-history.ts`) owning the clipboard history state, IPC calls and the
  revision/generation race guards; the clipboard panel view renders it and the ai-vision `clipboard` namespace uses it.
- **Board-library operations** (create board, delete board with untrust + unpin, remove toolset) in a board-module
  service; `CommitDiffPanelModel` loads commits; `MarkdownEditor.followLink(href)` next to `navigateBack`.
- **`TreeProviderHost`** (`editors/base/tree-provider-host.ts`) + `TREE_PROVIDER_HOST_TRAIT` + one
  `TreeRevealController`, adopted by Archive, Explorer and Link; the Explorer model owns its `FileTreeProvider`;
  Category finds hosts through the trait.
- **`ExplorerEditor` split:** the Explorer keeps the file tree and search; Clipboard and Boards become their own panel
  editors; one `attachExplorer(page, …)` factory replaces the copied construction boilerplate; the persisted
  `boardsOpen` / `clipboardOpen` / `hideExplorer` flags are migrated once.
- **One view-port pattern** for the DOM handles facades need: the view attaches a typed port on mount and clears it on
  unmount; the ad-hoc model handles go.

## Decisions this epic acts on

- **Scope: five tasks, all of part 3.** Order: US-1939 clipboard model → US-1940 board operations, commit-diff
  loading and Markdown `followLink` → US-1941 `TreeProviderHost` (includes EDC-9 step 3, the Explorer owning its
  provider, which EDC-11 depends on) → US-1942 `ExplorerEditor` split (moves the panel views US-1939/1940 already
  slimmed) → US-1943 view ports (EDC-9 step 6, independent of the panel cluster; last because it touches the Markdown
  model US-1940 changes). US-1942 is planned only after US-1939–1941 are implemented, so its plan reads the real code.
- **Behaviour is kept.** The clipboard panel's revision and generation counters move unchanged. Board deletion keeps
  its confirmation, order (remove folder, untrust, unpin) and toasts. The Explorer panel order (Explorer → Search →
  Boards → Clipboard), which panels a restored page shows, and the dedicated Clipboard page stay the same. Facades on
  an inactive page (no port attached) keep their current errors. Rendered DOM, CSS classes and `data-name` values of
  every touched view stay identical.
- **Persisted data.** Page descriptors with `boardsOpen` / `clipboardOpen` / `hideExplorer` are read once and
  promoted through the existing descriptor-migration owner (`api/pages/descriptor-migrations.ts`, which EPIC-164 used
  for the grid legacy settings) rather than a special case in `PagesPersistenceModel`; a restored page shows the same
  panels as before. If the split needs a new persisted shape, the migration owner writes it and the old fields stay
  readable.
- **Contracts that must not change:** the script API and facades, ai-vision paths and output (the `clipboard`
  namespace included), MCP `call`, the `data-name` contract, i18n keys and existing messages. `window.persephone` is
  not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that changes the board-facing surface is sent back.
- **Owners.** `api/clipboard-history.ts`; the board-library service in the board module (the plan picks the file next
  to the existing board trust/pin owners and names it); `CommitDiffPanelModel`; `MarkdownEditor.followLink`;
  `editors/base/tree-provider-host.ts` (+ trait and reveal controller); `editors/clipboard/` and `editors/board/` for
  the moved panel views (EDC-10 step 4, BRD-8); `page-explorer.ts` `attachExplorer`; the view-port type in
  `editors/base/`.
- **No new protocol code, no `await import()` to break a cycle** (guardrails 1, 5). Board rules stay in the board
  module (guardrail 2). Editor code keeps its literal `import()` rows (critical pattern 1).
- **God files only shrink** (guardrail 3): `ExplorerEditorModel.ts` (416), `ClipboardSecondaryView.ts` (705),
  `BoardsSecondaryView.ts` (460), `ExplorerSecondaryView.ts` (421), `CommitDiffPanel.ts` (417), `LinkEditor.ts`
  (1116), `ArchiveEditor.ts` (242).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1939 | `ClipboardHistoryModel`; clipboard panel and ai-vision consume it | Done |
| US-1940 | Board-library operations, `CommitDiffPanelModel` loading, `MarkdownEditor.followLink` | Done |
| US-1941 | `TreeProviderHost`, trait and `TreeRevealController`; Explorer owns its provider | Done |
| US-1942 | `ExplorerEditor` split: Clipboard and Boards panel editors, `attachExplorer`, flag migration | Done |
| US-1943 | View ports for facade DOM handles | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the files under
  "God files only shrink". For every exported symbol that moves or is renamed, list its importers and update them (no
  re-export shims). Every `data-name` in a touched view listed and shown preserved. No unit tests or harnesses.
- **US-1939.** Every piece of state and every IPC call in `ClipboardSecondaryView` and the ai-vision clipboard
  namespace → its `ClipboardHistoryModel` member; the race guards moved verbatim; lifetime (who starts/stops
  monitoring and when — panel mount, dedicated page, ai-vision call) shown identical.
- **US-1940.** Per board operation: today's steps, confirmations, toasts and error handling → the service method;
  check for an existing owner first (board trust, pins, busy boards, uninstall/rename paths) and reuse it. Commit diff:
  the generation guards moved into the model. Markdown: every implementer of `navigateLink` (About guide included)
  → `followLink`.
- **US-1941.** Per host (Archive, Explorer, Link): provider creation and recreation on root change, selection state,
  reveal counter and the panel's reveal scheduling → `TreeProviderHost`; the Explorer's `listItems`/`openItem` work
  before a view mounts; Category's three imports removed.
- **US-1942.** All construction sites of `ExplorerEditor` (search `new ExplorerEditor`), the persisted flags and every
  reader/writer, the header buttons and how they open/close panels, the dedicated Clipboard page, panel order and
  restore. `listBoards` path normalising uses `fpNormalizeForCompare`.
- **US-1943.** Per handle (Markdown, HTML, Video, ScriptPanel, Grid): the facade or caller that reads it, its behaviour
  when no view is mounted, and the port member that replaces it.

## Out of scope

- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-13
- Epic created after EPIC-164. Current state re-checked against the code (see Overview). All of part 3 fits five
  tasks, so roadmap item 6.4 closes with this epic.
- EPIC-164 had been committed (87568404) with its completion skills done but without the closing bookkeeping
  (dashboard block, `epics/completed.md`, roadmap status); that bookkeeping is done in this epic's commit.
- Codex weekly window had 38% left at the start, so planning runs on Luna (the policy pick).

### 2026-11-14 — plan reviews and implementation
- **US-1939.** Correction: remove/clear have two error contracts (the panel toasts only while mounted; ai-vision
  sees the raw rejection), so `ClipboardHistoryModel.remove`/`clear` are raw pass-throughs and the panel keeps its
  confirmation + toast. One model per panel (today's start/stop per mount) plus an inert, never-started instance for
  the ai-vision node. `ClipboardSecondaryView.ts` 705 → 585.
- **US-1940.** Decision: EDC-9 step 2 is already satisfied by earlier board epics — the Boards panel delegates deletion
  to `boardLifecycle.delete` (untrust, install cleanup; `editorCategories` unpins on untrust) and creation to
  `createBoardFromTemplate` through the dialog. The proposed `board-library.ts` would only forward to those owners, so
  it was dropped. Toolset removal stays `toolsTrust.untrust` + the view's info toast (no UI dependency added to a
  storage owner). `CommitDiffPanelModel` moved to its own file with the loading and guards (`CommitDiffPanel.ts`
  417 → 329); `MarkdownEditor.followLink` is required on the body model (About guide: `page` is undefined, so a
  non-guide link stays a no-op as before).
- **US-1941.** Corrections: Link's provider stays lazy through the trait (`TreeProviderHost` takes an optional
  `createProvider`); the Explorer model owns replacement by subscribing to its own `rootPath` (covers the four external
  `TComponentState` construction sites) with the view's exact predicate `provider?.sourceUrl !== rootPath`; the view
  rebuilds on the host's `providerState`, not on `rootPath`, so it never reads a stale provider. Line counts:
  `ArchiveEditor.ts` 242 → 239, `ExplorerSecondaryView.ts` 421 → 414; `ExplorerEditorModel.ts` 416 → 426 and
  `LinkEditor.ts` 1116 → 1119 grew slightly (the provider subscription and lazy factory); the Explorer model shrinks
  in US-1942.
- **US-1943.** Corrections: Grid uses `ViewPort<DataGridInstance>` directly (a forwarding interface would re-declare
  the widget's methods); `setGrid` stays the attach entry. `ScriptPanelModel.editorRef` was already gone (callback
  path), so four handles were converted. One deliberate refinement: a view's detach clears only its own registration,
  so a stale view can no longer clear a newer view's port (before, `setX(null)` cleared unconditionally).
- **US-1942.** Corrections: the Boards/Clipboard panel MODELS are imported statically so
  `panels.explorer.openBoards()` stays synchronous for scripts (views stay behind the registry's literal `import()`
  rows); Boards keeps no persisted root copy — it reads the page Explorer's root and rebinds when the Explorer
  attaches later or changes. Panel order (Explorer → Search → Boards → Clipboard) and the closable sidebar come from
  two generic `EditorModel` fields (`panelOrder`, `sidebarOptional`) instead of the old Explorer-id special cases; every
  other contributor keeps the defaults (order 10, mandatory). The legacy `boardsOpen` / `clipboardOpen` /
  `hideExplorer` flags are migrated once by `migrateLegacyExplorerPanels` in `descriptor-migrations.ts` (idempotent;
  rewrites a transferred active-panel key). `ExplorerEditorModel.ts` 426 → 318. The `listBoards` normalising keeps
  its expression: `fpNormalizeForCompare` resolves and strips trailing separators, so it is not key-identical.
- **Behaviour change (accepted, the only one):** `page.panels.items[]` reports the Boards and Clipboard panels with
  their own owner (`editorKind: "boards"` / `"clipboard"` and their own `editorId`) instead of the Explorer's.
- **Live checks (cold start):** md/html/csv grid/zip/link editors render; Markdown link following; HTML
  `viewMounted`; grid `addRows`; Explorer list/open folder → Category view; Archive panel; Link panels; commit diff on
  a temp repo with commit switching; Explorer + Boards + Clipboard panels in fixed order regardless of click order;
  `openBoards()` readable at once; Explorer close hides the sidebar with Boards/Clipboard present; a legacy dedicated
  Clipboard page and a new-format folder page restored after restart; the migration function exercised on legacy
  descriptors (idempotent).
- **Completion (2026-11-14).** `/review` (Codex): no architecture defects; it flagged four `gridPort.get()!` assertions,
  which were replaced by a local `const grid` check (no behaviour change). `/document` updated `key-files.md`,
  `folder-structure.md`, `overview.md`, `pages-architecture.md`, `secondary-views.md` and `model-view-pattern.md`.
  `/userdoc`: no guide change needed. No catalog messages changed; `npm run i18n:check` is complete.
