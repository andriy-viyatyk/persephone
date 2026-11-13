# EPIC-163: Refactoring Phase 6.4 part 1 — editor framework: typed editor ids, one matcher contract, `EditorCatalog`, switch strategies, a slimmer `EditorModel` and typed editor modules

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the twenty-third epic of the [refactoring roadmap](../refactoring-roadmap.md) and covers the first part of
roadmap item **6.4, Editor framework**: EDC-2, EDC-5, EDC-6 and EDC-7 (step 1 and the shared helpers of step 3) in
`doc/reviews/refactoring-2026-11/07-editors-core.md`. Item 6.3 closed with [EPIC-162](EPIC-162.md). Item 6.4 lists
eleven findings (EDC-2, 5–14); they do not fit one epic, so this epic takes the framework core in `editors/base/` and
the rest is recorded below as part 2.

The code was checked on 2026-11-13, after EPIC-162. Line numbers in the report have drifted; the current state:

- **Done by earlier epics.** EDC-1 (Phase 4.6, `content-host-slot.ts`), EDC-3/EDC-4 (Phase 5.4: one editor shape, no
  `EditorOrHost`), BRD-3's board-editor factory (Phase 3.5, `editors/editor-factory.ts`), the board domain move to
  `api/boards/` (Phase 2.1), `parseBoardEditorId` in `src/shared/board/board-editor-id.ts` (EPIC-161).
- **`editors/base/` still knows boards.** `editor-switch.ts` imports `board-editor-id`, `board-info-id`,
  `source-context`, `board-masks`, `board-manifest-schema`; `editor-switch-options.ts` imports
  `api/boards/board-install-registry`, `published-boards`, `board-display-text`, `board-manifest-queries`,
  `board-root`; `PageToolbarView.ts` subscribes to `boardInstallRegistry`, `publishedBoards`, `customEditorRegistry`
  and `onBoardDisplayTextChanged`; `EditorModel.ts` declares `EditorOpenContext` with a `BoardSourceContext` and the
  `acceptOpenContext` hook. There is no ESLint zone for `editors/base/**` yet.
- **Resolution is merged by hand.** `resolveEditorIdForFile` / `getFolderEditorsForFolder` / `getEditorSwitchOptions` /
  `switchMainEditor` are used from 23 files, many outside `editors/` (`api/pages/*`, `content/*`, `api/boards/*`,
  `ui/link-menus`, `scripting/ai-vision`, `components/icons`, `shared/board/board-masks.ts`).
- **The registry (`editorRegistry.ts`, 412 lines)** still has `AcceptanceInput` and `accepts(input)` next to
  `match.acceptFile`, `match.switchOption`, `match.validForLanguage` and `match.detectsContent`; `EditorModule.View` is
  `VanillaViewCtor<{ model: EditorModel }>`, so 21 files re-narrow with a `requireXxxModel` guard.
- **`EditorModel.ts` (383 lines)** extends the dialog model, types `queue` as `ComponentQueue<E>` (nine
  `as unknown as` queue casts in `editors/`), and carries single-implementer hooks (`acceptOpenContext`, `onReopen`,
  `revealFragment`, `isFreshEmpty`).

## Goals

- **Typed editor ids** (`editors/base/editor-ids.ts`): `EditorId` constants typed as the existing `EditorView` union,
  `BoardEditorId` (`` `board-editor:${string}` ``), `editorId: EditorView | BoardEditorId`, a `NavigationSourceId`
  union and one `BOARD_CONTEXT_SOURCE_IDS` set. Registry dead code gone (`AcceptanceInput.mode`, any remaining
  `resolveForFile`, `detectedContentEditor` and its detection timer, "Mirrors the legacy …" comments).
- **One matcher contract** with named tiers and one `rank(input)` used by resolve, switch options, preview and accept,
  with one documented sort rule implemented once.
- **`EditorCatalog`** (`editors/base/editor-catalog.ts`) with `EditorSource`s: `BuiltInEditorSource` over
  `editorRegistry`, and a board-owned `BoardEditorSource` (custom-editor registry, install registry, published
  catalog, display names) registered by the board module at startup. `editorCatalog.switchCandidates(model)` includes
  the current editor and places "+" once; the `[this.editorId]` overrides in Archive and Video and Archive's
  `filePath` override go away. `PageToolbarView` subscribes to the catalog only. Callers outside `editors/` use the
  catalog.
- **Switch strategies.** `switchMainEditor` dispatches through registered `EditorSwitchStrategy`s: `base/` registers
  host-transfer, rebuild-over-file and folder-factory; Board Info registers the install strategy; the board module
  registers content-host and simple-board strategies (using the existing board-editor factory); the category link
  enrichment moves into the category module's folder factory.
- **A slimmer `EditorModel`:** extends `TModel` (no dialog protocol), generic over requests
  (`EditorModel<T, E, Q = never>` with `queue: ComponentQueue<E, Q>`), single-implementer hooks become traits on the
  existing `TraitSet` (`OPEN_CONTEXT_TRAIT` owned by the board module, `REOPEN_TRAIT`, `FRAGMENT_NAV_TRAIT`,
  `NAVIGATION_SINGLETON_TRAIT`); the queue casts, `focusEditor` duplicates and unused `hasTextSelection` are deleted.
  `EditorStatusBarView`'s `boardStart`/`boardEnd` become `startContributions`/`endContributions`.
- **`editors/base/**` imports no board module**, enforced by an ESLint `no-restricted-imports` zone (error level,
  like the existing `api/` → `editors/board` zone).
- **Typed editor modules:** `EditorModule<M extends EditorModel>` with `View: VanillaViewCtor<{ model: M }>`,
  `defineEditorModule(ModelClass, def)` doing the single `instanceof` check; the `requireXxxModel` guards deleted;
  `SecondaryViewProps<M>` typed the same way; `createContentsElement(part?)` and a `ToggledIconButton` helper replace
  the copies.

## Decisions this epic acts on

- **Scope: part 1 of 6.4 in six tasks.** The framework core (EDC-5, EDC-2, EDC-6, EDC-7 step 1 + step 3 helpers).
  These change the contracts every editor is built on, so they go first; part 2 (below) is per-editor work that
  becomes simpler once these land.
- **Order.** US-1928 ids + dead code → US-1929 matcher contract → US-1930 `EditorCatalog` + sources → US-1931 switch
  strategies → US-1932 slimmer `EditorModel` + the `editors/base` import zone (the last board import in `base/`,
  `BoardSourceContext` in `EditorModel`, leaves here) → US-1933 typed modules. Each task builds on the previous one.
- **Behaviour is kept.** The visible editor-switch segments per file type, folder and board (order, labels, the "+"
  entry last, the hide rule "current editor in list and at least two options"), the editor picked for opening a file
  or folder, the preview editor, Monaco's `validForLanguage` fallback, Board Info's switch ordering, and content
  detection in the switch widget must not change. **US-1929 and US-1930 must snapshot the current results before
  changing code** (a table per representative file type: `.txt`, `.json`, `.jsonl`, `.csv`, `.md`, `.mmd`, `.svg`,
  `.html`, `.png`, `.mp4`, `.zip`, `.excalidraw`, `.rest.json`, a `.log.jsonl`, a folder, a folder with a marker, a
  content-detected JSON in a `.txt`) and show the table is identical after. If the single tier rule cannot reproduce
  today's order, the task keeps today's order with an explicit, commented exception rather than reordering.
- **The `.excalidraw` exclusion** in the built-in grid matcher moves out of `base/` only if the board source can
  express "a content-host board claims this file" without changing what users see; otherwise it stays and is recorded.
- **Contracts that must not change:** persisted page descriptors and their `editorId` strings (`"monaco"`,
  `"board-view"`, `board-editor:<…>`, …); the script API (`page.editorSwitches`, facade ids, `output.editor.id`);
  ai-vision `page-editor-switches` output; MCP `call`; the `data-name` contract (`text-chrome-root`,
  `text-run-script`, switch segments); i18n keys and messages. `window.persephone` is not touched, so no
  `BOARD_BRIDGE_VERSION` bump — a plan that changes the board-facing surface is sent back.
- **Owners.** `editors/base/editor-ids.ts` (ids, `NavigationSourceId`, `BOARD_CONTEXT_SOURCE_IDS`),
  `editors/base/editor-matchers.ts` + `editorRegistry.ts` (tiers and `rank`), `editors/base/editor-catalog.ts`
  (catalog, `EditorSource`, `EditorCandidate`, `EditorSwitchStrategy` registry and the built-in source and
  strategies), the board-side source and strategies in `api/boards/` or `editors/board/` (the plan picks one and
  states why; `api/` must keep its existing zone rules), Board Info's strategy in `editors/board-info/`, the category
  folder factory in `editors/category/`, `OPEN_CONTEXT_TRAIT` and `EditorOpenContext` in a board-owned module,
  generic traits in `editors/base/editor-traits.ts`, `createContentsElement` / `ToggledIconButton` in
  `uikit/shared` (or the existing UIKit home the plan finds).
- **Registration point.** `BoardEditorSource` and the board/board-info strategies are registered from the renderer
  startup table (the plan names the phase and shows registration happens before the first page restore resolves an
  editor), not by import side effects.
- **No new protocol code, no `await import()` to break a cycle** (guardrails 1, 5). Editor code keeps its literal
  `import()` per row in `register-editors.ts` (critical pattern 1).
- **God files only shrink** (guardrail 3): `editor-switch.ts` (253), `editor-switch-options.ts` (223),
  `PageToolbarView.ts` (472), `EditorModel.ts` (383), `editorRegistry.ts` (412) end smaller or are replaced.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1928 | Typed editor ids and registry dead code | Done |
| US-1929 | One matcher contract with named tiers and one `rank` | Done |
| US-1930 | `EditorCatalog` with built-in and board `EditorSource`s | Done |
| US-1931 | Editor switch strategies | Done |
| US-1932 | Slimmer `EditorModel`: `TModel`, typed queue, traits; `editors/base` import zone | Done |
| US-1933 | Typed `EditorModule<M>`, `defineEditorModule`, typed secondary views, shared view helpers | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the files
  under "God files only shrink". For every exported symbol that moves or is renamed, list its importers and update
  them (no re-export shims). No unit tests or harnesses.
- **US-1928.** Inventory of `"monaco"`, `"board-view"`, `"md-view"` and other literal editor ids (count per file) and
  which become `EditorId.*`; leave persisted/serialized strings and user-facing script API strings as data. The three
  copies of the navigation source-id list (`editor-switch.ts`, `BoardEditorModel.ts`, `LinkEditor.ts`). Show
  `detectedContentEditor` has no readers (code, `.d.ts`, assets, guides) and what happens to the persisted field on
  restore (ignored, not migrated).
- **US-1929.** Table: every registered editor → its current `accepts`/`acceptFile`/`switchOption`/
  `validForLanguage`/`detectsContent` → its new tiers. Every registry query method → which predicates and sort it
  uses today → its `rank` call after. The before/after behaviour table (see Decisions).
- **US-1930.** `EditorSource`/`EditorCandidate` shapes; every call site of the merged resolution (23 files) → its
  catalog call; the two duplicated branches in `editor-switch-options.ts` → one; the `PageToolbarView` subscriptions
  → one catalog subscription; the Archive/Video `[self]` and `filePath` overrides removed with proof the widget still
  shows the same segments. Before/after behaviour table.
- **US-1931.** Every branch of `switchMainEditor` today (with its ordering comment) → the strategy that owns it and
  its registration point; strategy selection order and how it reproduces the current branch order (Board Info first).
- **US-1932.** Every `EditorModel` member → keep / trait / delete, with its implementers and callers; proof the dialog
  members (`close`, `result`, `onClose`, `canClose`) have no editor callers; the nine queue casts; the zone rule text.
- **US-1933.** Every `requireXxxModel` guard (21) and `createContentsRoot`/`createContentsPart` copy → replacement;
  `SecondaryViewProps` casts; confirm the editor-guide example compiles against the new type.

## Part 2 (not in this epic)

Recorded for a follow-up epic (EPIC-164 or later), roadmap item 6.4 part 2:

- EDC-7 step 2 and 4: the shared `TextEditorPageView<M>` with `createParts(model)` adopted by the text editors;
  "Show resources" as an HTML-language contribution using `toFileUrl`; main view file naming in `editor-guide.md`.
- EDC-8 shared image actions and toolbar; the rest of the `image-export.ts` split.
- EDC-9 panel views without IO (`ClipboardHistoryModel`, board-library operations, Explorer-owned `FileTreeProvider`,
  `CommitDiffPanelModel` loading, `MarkdownEditor.followLink`, the view-port pattern).
- EDC-10 `ExplorerEditor` split into panel editors with `attachExplorer`.
- EDC-11 `TreeProviderHost` + `TREE_PROVIDER_HOST_TRAIT`.
- EDC-12 `content/source-watch.ts` and `movedSource`.
- EDC-13 `VideoStreamSession`, recording helpers, mute ownership.
- EDC-14 grid codecs and the legacy-settings migration.

## Out of scope

- Any change to `window.persephone`, the script API, MCP `call`, persisted descriptors, i18n messages or the
  `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-13
- Epic created after EPIC-162. Current state re-checked against the code (see Overview). Scope split into part 1
  (this epic) and part 2 (above).

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; plans by Codex (Luna, the policy pick while the weekly
  window was tight), reviewed against the source and the roadmap guardrails; Codex Luna implemented. Typecheck, lint
  and build-prod passed after each task, and every task was checked live on a cold `npm start` through the MCP HTTP
  endpoint.
- **Live checks.** Before US-1928 the editor-switch state (current editor and ordered option ids/labels) was recorded
  for 20 fixture files (`.txt`, `.json`, `.jsonl`, `.csv`, `.md`, `.mmd`, `.svg`, `.html`, `.xml`, `.png`, `.mp4`,
  `.zip`, `.excalidraw`, `.rest.json`, `.log.jsonl`, a content-detected log `.jsonl`, `.link.json`, `.env.json`, a
  JSON-content `.txt`, a folder), plus `app.editors.getSwitchOptions` for seven language/file pairs and the Board Info
  page's options. After every task the same probes matched, except the one intended change below. From US-1930 on,
  switch sequences were replayed (REST Client board → text → grid → board → text; Excalidraw board ↔ text; JSON →
  grid → text; Markdown ↔ text; Archive → Board Info → Archive; log view → text → grid → log view) with identical
  results; from US-1932 every fixture type was opened and its page editor snapshotted with no `Editor crashed`
  console errors; the Explorer panel on a folder page rendered its tree.
- **Sizes (wc -l), epic start → end.** `editor-switch.ts` 253 → 13 (strategies: `base/editor-switch-strategies.ts`
  161, `board/editor-switch-strategies.ts` 92, plus Board Info and Category modules); `editor-switch-options.ts`
  223 → 47; `PageToolbarView.ts` 472 → 411; `EditorModel.ts` 383 → 374; `editorRegistry.ts` 412 → 410;
  `TextChromeView.ts` 502 → 462. New: `editor-catalog.ts` 215, `api/boards/board-editor-source.ts` 127.
- **Decision refinements (plan review).** US-1929: the content-detected log ordering (`[log-view, monaco, …]`) is not
  an exception — it falls out of the host-switch rule (content 60 > Monaco host 50 > specialized file 20 > language
  10); per-query rules became one declarative `QUERY_RULES` table read by `rank()`, and the script API
  `app.editors.getSwitchOptions` keeps its own ascending order (it differs from the toolbar for `.env.json`, and that
  is preserved). The `.excalidraw` grid exclusion stays in the built-in matcher: a board source cannot express an
  unconditional extension rule for unclaimed files. US-1930: the plan's `legacyVisible`/`currentSwitchOption`
  metadata (to keep Image's `[]` options) was sent back; the catalog always includes the current editor;
  `findCompatibleEditors()` is a one-way built-in-candidates hook (catalog → model, never back) to rule out
  recursion; `Archive.filePath` stays (switch and Board Info read it). US-1931: strategies are registered from the
  renderer composition root (`src/renderer/index.ts` → `editors/register-switch-strategies.ts`, awaited by the
  startup runner before any phase) instead of new startup-context plumbing; strategy modules stay light and keep
  today's lazy `import()` of editor code inside `run()`. US-1932: the `editors/base` zone uses
  `import/no-restricted-paths` like the existing `api/` zone, with `shared/board/board-editor-id.ts` as the only
  allowed `shared/board` import; `matchesNavigationTarget`/`onNavigationReuse` stay on the class (four and three
  implementers), so only `acceptOpenContext` (board, `api/boards/board-open-context.ts`), `onReopen`, `revealFragment`
  and `isFreshEmpty` became traits; `EditorModel.ts` shrank less than projected because the remaining members are
  shared lifecycle.
- **Defect caught in smoke check.** US-1932's bulk queue rewrite left a self-recursive `queueFor` helper in
  `MarkdownBodyView.ts` (stack overflow, every Markdown page crashed on a cold start). Fixed by the epic owner before
  staging; `/review` later replaced its non-null assertion with a runtime guard.
- **Review.** `/review` raised one finding (the `typedQueue!` assertion above, fixed); `/document` updated
  `editors.md`, `key-files.md`, `pages-architecture.md` and `editor-guide.md`; `/userdoc` needed no changes. No English
  catalog messages changed; `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour change.** The editor switch always includes the current editor. AiVision
  `page.editorSwitches.options` for an image page is now `[image-view]` instead of `[]` (the toolbar is still hidden
  with one option), and a board whose file mask claims an image extension now appears in the image page's switch
  (before, it was invisible because Image had no self-entry workaround).
- **Not exercised live (needs a manual test by the user):** folder-editor switching from the Explorer (Category ↔ Git
  tree ↔ Mneme root ↔ folder boards, including Category's provider-aware link), Board Info opened from a folder and its
  return, installing/uninstalling/renaming a board and a published-catalog update refreshing the switch live, opening
  a link that enqueues a source into an open board (open context trait), reopening a playing video file
  (`REOPEN_TRAIT`), opening a Markdown link with `#fragment`, and the first-empty-page replacement on opening a file.
