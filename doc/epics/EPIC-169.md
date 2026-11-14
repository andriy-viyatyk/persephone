# EPIC-169: Refactoring Phase 6.6 part 2 and 6.7 part 1 — Tools hub entry list, shared markdown search and roots tree, one board-vars format owner, provider capabilities and `ProviderItemController`

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the twenty-ninth epic of the [refactoring roadmap](../refactoring-roadmap.md). It finishes roadmap item **6.6,
Tool editors** (part 2: findings **EDT-11** and **EDT-12** in `doc/reviews/refactoring-2026-11/08-editors-tools.md`)
and starts item **6.7, Tree and UIKit** with its first slice, **UIK-3** (`doc/reviews/refactoring-2026-11/09-uikit.md`),
which the roadmap puts at the head of the 6.7 chain (UIK-3 → UIK-2 → UIK-1).

The code was checked on 2026-11-14, after EPIC-168. The findings still hold:

- **Tools hub (EDT-11).** `editors/tools-hub/SearchBoardsTab.ts` (538 lines) joins the published catalog, the install
  registry and the update list in the view, builds `{ fileMasks, standalone } as BoardManifest` for `boardUsageGroup`
  (`:35-40`) and imports `editors/board-info` internals (`:13-14`). `ToolsHubEditor.ts:32` still says "Five content
  tabs". The Category view mode has two owners: `CategoryEditor.ts:44-46,143-150` loads and persists it through
  `folderViewModeService` while `CategoryEditorModel.ts:156` exposes a separate `viewMode` getter. EDT-11 step 3 (a
  tree-provider host capability) is already met by EPIC-165's `TREE_PROVIDER_HOST_TRAIT`.
- **Smaller duplicates (EDT-12).** `editors/about/AboutGuidePageView.ts` (392) hand-builds a `MarkdownBodyModel` and
  re-implements the search-state transitions (`:349-355`); `editors/tools/tools-tree-build.ts:7` calls itself "a
  near-copy of `boards-tree-build.ts`"; the board-vars file has a strict validator in `EnvVarsEditor.ts:290` and a
  cast-only read in `api/board-vars/BoardEnvStore.ts:106`; variable-row validation sits in `EnvVarsBodyView.ts`; the
  multiselect comma-joined storage format is encoded in the settings view (`BoardSettingsSection.ts:143`, its
  `BoardMultiselectField`) instead of the board-settings types.
- **Provider item glue (UIK-3).** `components/tree-provider/TreeProviderViewModel.ts` (1,316) and
  `CategoryViewModel.ts` (790) each carry the same adapter code over the shared action modules (watch subscription with
  `provider as any` at `CategoryViewModel.ts:236`, CRUD context, menu layering, plural targets, drag items, delete,
  background menu, key guard, OS drag start); `supportsOsClipboard` (`os-clipboard.ts`) and `supportsMultiSelect`
  (`plural-actions.ts`) are the same `type === "file"` test under two names; hrefs are compared four different ways
  (roadmap bug #17).

## Goals

- **Tools hub:** `publishedBoards.listEntries()` in `api/boards/published-boards.ts` returns one joined entry per
  catalog board (`board`, display text, `usageGroup`, `installed?`, `update?`, `compatible`); `SearchBoardsTabView` only
  filters and renders and the 11-field signature comparator goes. `boardUsageGroup` accepts
  `Pick<BoardManifest, "fileMasks" | "standalone">`. `CategoryEditorModel` owns the view mode (state field, load,
  `setViewMode` persisting through `folderViewModeService`); the view reads it. The stale comment is fixed.
- **Markdown and roots tree:** `MarkdownSearchState` (open, close, setText, setMatchCount, next, prev with the existing
  wrap-around) and `createStandaloneMarkdownBodyModel()` in `editors/markdown/`, used by the Markdown editor and About;
  one `buildRootsTree` used by both the boards tree and the tools tree.
- **Board vars and multiselect:** one module owns the `.env.json` format — the strict validation used by the editor and
  the store's tolerant read side by side; row validation (`validateRows`, `rowsToRecord`) moves into
  `EnvVarsEditor.trySetProfileRows(namespace, profile, rows): string | undefined`; `encodeMultiSelect` /
  `decodeMultiSelect` in `api/board-settings/types.ts`, used by the settings view.
- **Provider capabilities and href identity:** a renderer-internal capability contract
  (`content/tree-providers/tree-provider-capabilities.ts`: `isWatchable`, `isIncremental`, one `isLocalFileProvider`
  replacing `supportsOsClipboard` and `supportsMultiSelect`), the `as any` / `as TraitTypeId` casts gone, and one
  `hrefKey(href)` in `href-utils.ts` for selection sets, membership checks and watch matching.
- **`ProviderItemController`** (`components/tree-provider/provider-item-controller.ts`) owns the CRUD context and menu
  actions, the item and background context menus, plural targets, drag items, OS drag start, the Delete/F2/clipboard
  keys and delete-many; both view models delegate and keep only how they resolve a selection. The drop-hover protocol
  moves to `uikit/shared/drop-target-tracker.ts`, used by `TreeDndModel` and `CategoryViewModel`.

## Decisions this epic acts on

- **Scope: five tasks.** EDT-11 and EDT-12 are both S-sized, so part 2 of 6.6 is three tasks (EDT-12 splits by area:
  Markdown/About + roots tree, and board vars + multiselect). That left room for the first coherent slice of 6.7.
  UIK-3 is P1, the roadmap's first 6.7 step, and independent of the rest: it touches `components/tree-provider/` and
  `content/tree-providers/`, while the 6.6 tasks touch `editors/tools-hub`, `editors/category` (the editor, not
  `CategoryViewModel`), `editors/markdown`, `editors/about`, the tree builders, `editors/env-vars`, `api/board-vars`,
  `api/board-settings` and the settings section. UIK-3 is split in two because steps 2–3 (capability contract and href
  identity) are a small, safe base and steps 1 and 4 (the controller and the drop tracker) are the M-sized part whose
  plan should read the real capability API. UIK-2 and UIK-1 follow in later epics.
- **Order.** US-1957, US-1958, US-1959 and US-1960 touch disjoint files and are planned in parallel. US-1961 is planned
  after US-1960 is implemented. Implementations run one at a time.
- **Board-vars loose read stays (EDT-12's open question).** `BoardEnvStore` serves every running board's variables; a
  hand-edited file with one non-string value or a non-object profile must not take every board's variables offline, so
  the store keeps accepting loose files exactly as today (empty text → `{}`, a non-object top level → `{}`, non-string
  values read as absent by `get`). The editor keeps its strict validation and its error messages byte-identical. What
  changes is ownership: both reads live in one module beside the types and share the empty-text and JSON-parse rule,
  so the format has one owner.
- **Multi-selection context menu (UIK-3's open question) follows D9.** The roadmap's accepted decision D9 says
  multi-selection menus use the tree's behaviour: run the menu layers with the selection. The controller therefore runs
  the event-channel layer for plural selections on the folder page too (the folder page has no parent callback, so
  that part stays absent there). This is a deliberate, recorded behaviour change on the folder page only.
- **Href identity.** Selection membership becomes case-insensitive everywhere through `hrefKey` (roadmap bug #17: a
  selection adopted with different casing could paint as selected yet be left out of plural menus and drags). Watch
  matching keeps its separator folding and `fpResolve` inside `hrefKey` only if that gives the same result for the
  inputs the watch path sees; otherwise the plan keeps the watch rule and says why.
- **Where the new modules live.** `listEntries` in `api/boards/published-boards.ts` (board domain, D7). The roots-tree
  builder goes where both callers can import it without a wrong-way edge; the planner checks
  `doc/standards/uikit-vs-components-split.md` (it is Persephone-coupled, so not `uikit/`). The capability contract is
  renderer-internal and stays out of the public `api/types/io.tree.d.ts`. The drop tracker is a pure primitive and goes
  to `uikit/shared/`.
- **Behaviour is kept.** Every rule moves verbatim apart from the two recorded changes above: the Tools hub card order,
  filters, compatibility, install/update state and search; the Category view-mode default (`"list"`), the per-path
  load-generation guard and the persisted `folderViewMode.json` keys; the Markdown/About search wrap-around and match
  counts; the boards and tools tree labels, order and ids; the board-vars editor error messages and the store's loose
  read; the multiselect stored string (separator, trimming, empty value); provider menus, drag/drop effects, the
  OS-clipboard and OS-drag conditions and the Delete/F2 keys. Rendered DOM structure, CSS classes and every `data-name`
  stay identical (before/after structural fingerprints of each affected surface).
- **Contracts that must not change:** `folderViewMode.json`, the board-vars `.env.json` format, the board settings
  stored values, the script API and facades, ai-vision paths and output, MCP `call`, `data-name`, `window.persephone`
  (not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back), the public
  `api/types/io.tree.d.ts`.
- **Guardrails.** No new protocol code (1). Board rules stay in `shared/board/` and the board registries (2):
  `boardUsageGroup` stays in `shared/board/board-manifest-queries.ts`; the joined entry list composes existing registry
  calls and adds no manifest reader or trust check. God files only shrink (3): `TreeProviderViewModel.ts` (1,316),
  `CategoryViewModel.ts` (790), `SearchBoardsTab.ts` (538), `AboutGuidePageView.ts` (392), `EnvVarsBodyView.ts` (775),
  `CategoryEditor.ts` (359). No `await import()` to break a cycle (5).
- **Live verification limits.** Tools hub checks read the catalog already cached by the app and never install, update
  or uninstall a board; board-vars checks use a temp `.env.json` under `%TEMP%` opened in the editor, never the user's
  real file, and never decrypt or save it; board settings are toggled and restored at once on a bundled board; tree
  and folder checks use a temp folder under `%TEMP%`; no delete, rename or drag is performed outside that folder.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1957 | Tools hub entry list and Category view mode in the model (EDT-11) | Done |
| US-1958 | `MarkdownSearchState` for Markdown and About, one roots-tree builder (EDT-12) | Done |
| US-1959 | One board-vars format owner, row validation in the editor, multiselect codec (EDT-12) | Done |
| US-1960 | Tree-provider capability contract and one href identity (UIK-3 steps 2–3) | Done |
| US-1961 | `ProviderItemController` and the drop-target tracker (UIK-3 steps 1 and 4) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the god files
  above. For every exported symbol that moves or is renamed, list its importers and update them (no re-export shims).
  Every `data-name` in a touched view listed and shown preserved. List every facade member that reaches the touched
  code and show its delegate. No unit tests or harnesses.
- **US-1957.** The three sources joined today (calls, keys, the `fpNormalizeForCompare(root)` keying) → the entry
  fields, with compatibility and install/update state computed exactly as the view does now; what replaces the
  signature comparator (entry identity or a version counter) and proof that every repaint trigger today still
  repaints; every `boardUsageGroup` caller; the Category view-mode load (default, generation guard, path change) and
  persist moved into the model with the view subscribing; whether anything else reads `CategoryEditorModel.viewMode`.
- **US-1958.** Today's search-state transitions in the Markdown editor and in About side by side (including the
  wrap-around and what `close` resets), and the shared class reproducing both; how About builds its body model today
  and what `createStandaloneMarkdownBodyModel()` returns; the two tree builders' differences (leaf label, ids, sort,
  base-root handling) and how one builder keeps each caller's output identical.
- **US-1959.** Both reads today side by side, the shared module and each caller's exact behaviour kept (see the
  decision above); `validateRows` / `rowsToRecord` moved with their messages; where the view calls
  `trySetProfileRows` and how it shows the returned message; the multiselect encode/decode today (separator, trimming,
  empty, duplicates) and every place that reads or writes the stored string.
- **US-1960.** Every duck-typed `watch` / `listIncremental` / `type === "file"` site and its replacement; which
  providers implement each capability; the casts removed; every href comparison in the two view models and the view
  impls with its current rule and the `hrefKey` replacement, and the watch-path rule decision.
- **US-1961.** Each duplicated pair from UIK-3 (both sites with lines) → controller method, and the differences between
  the copies with the rule chosen for each (D9 for the plural menu; the OS-drag override location); the drop-hover
  protocol in `TreeDndModel` and `CategoryViewModel` side by side → `DropTargetTracker`; the editable-target key guard;
  what each view model keeps.

## Out of scope

- UIK-2 (controlled tree expansion, single lazy-load owner) and UIK-1 (`TreeProviderViewModel` split): later 6.7 epics.
- Roadmap item 2.4 moves.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-168. Findings re-checked against the code (see Overview). Codex weekly window had 28% left
  and the 5-hour window 92%; the policy pick is Luna for planning as well.

### 2026-11-14 — plan reviews and implementation
- **US-1959.** Corrections: the editor's empty-content fast path stays byte-for-byte (it resets both selections and
  records the state reference, which the parse path does not); the shared `parseBoardVarsText` empty-text rule is used
  by the store, and the strict `validateBoardVarsFile` by the editor's non-empty path. Row validation moved into
  `EnvVarsEditor.trySetProfileRows`; the grid view brackets the call with an `applyingRows` flag (cleared in `finally`)
  so the synchronous state update adopts the committed record instead of reseeding the grid, exactly as the old
  pre-assigned `appliedData` did (state dispatch is synchronous, `core/state/state.ts`). `decodeMultiSelect` /
  `encodeMultiSelect` in `api/board-settings/types.ts`. `EnvVarsBodyView.ts` 775 → 754.
- **Live check (cold start, after US-1959):** env-vars editor fingerprints for the default fixture and six error
  states (non-string value, array, non-object profile, non-object namespace, broken JSON, empty) identical, error
  messages included; `trySetProfileRows` returns the same "Not saved — …" text for empty + duplicate names, writes
  nothing on failure, trims names and keeps values; the board multiselect field fingerprint identical. Not exercised:
  writing a multiselect value (it would change a real board setting; the codec is the moved code verbatim).
- **US-1957.** Corrections: a fresh-object identity gate would rebuild every card on every keystroke and drop
  unrelated cards' button state, so `PublishedBoardEntry.detailsKey` (the old 11 signature fields, serialized by
  `listEntries()`) gates the details rebuild and the screenshot still updates on every card update; the
  `CategoryEditorModel.viewMode` getter keeps its "no provider / no category → list" guard for the facade; the model
  loads per `categoryPath ?? ""` with the same last-path dedupe and generation guard. `board-update-query.ts` holds the
  pure update rule so `published-boards.ts` can use it without a cycle with `board-updates.ts`. `boardUsageGroup` takes
  `Pick<RawBoardManifest, "fileMasks" | "standalone">` (the schema has no `BoardManifest` type).
  `SearchBoardsTab.ts` 538 → 457, `CategoryEditor.ts` 359 → 337.
- **Live check (cold start, after US-1957):** Tools hub Search boards fingerprint identical (24 cards, text included);
  typing a filter keeps the surviving cards' buttons (66/66 tagged nodes still connected); Category folder fingerprint
  identical; switching to Landscape through the view-mode menu persists the folder key, a sibling folder loads "list",
  returning loads "tiles-landscape", and the facade `viewMode` follows. The temp folder key was set back to List and
  `folderViewMode.json` restored from a backup.
- **US-1958.** Corrections: About's navigation reset stays two whole-state `set` calls (it also resets `compactMode`
  and always publishes), now the standalone bundle's `reset()`, not `searchState.close()`; the shared
  `buildRootsTree` (`components/roots-tree-build.ts`) keys segments from the path and never from the display label,
  and keys a root that equals or escapes the base by the full root (the tools rule). The one difference for boards:
  two board roots that both equal/escape the base and share a basename no longer collapse into one leaf; every board
  caller that passes a base pre-filters to roots under it, so the path is defensive only. Board leaf sorting still
  uses the final display label. `AboutGuidePageView.ts` 392 → 317; both old builders deleted.
- **Live check (cold start, after US-1958):** Tools hub Editors and Tools trees identical (fingerprint and rows, after
  board icons finish loading); About guide search (152 matches, next/next, prev×3 wrapping to 152, Escape, reopen) and
  the Markdown editor search on a temp file identical in all five states.
- **US-1960.** Corrections: the `isTraitTypeId` guard keeps the `ILink` fallback only after verifying that no provider
  with a non-enum `dragTraitTypeId` can reach `TreeProviderViewImpl` (all mounts are built-in; the only setter is
  Mneme's `MnemeLink`), so the branch is unobservable; each watchable provider's callback payload recorded.
  Watch matching keeps `fpNormalizeForCompare` (filesystem paths; `hrefKey` also serves `mneme://` and archive hrefs).
  `TreeProviderViewModel.ts` 1,316 → 1,309, `CategoryViewModel.ts` 790 → 787.
- **Bug fixed (US-1960, found by the planner, reproduced live).** `LinkTreeProvider.watch` handed its callback to a
  selector subscription, which calls listeners with the selected value, so the tree's `queueWatchRefresh` received the
  links array as a "batch", threw on `batch.changes.length` before its try block and only logged: the Link editor's
  category panel never rebuilt when links changed (a link added in a new category did not show its category until the
  file was reopened). The provider now calls `callback()` with no argument and the tree takes its full-rebuild path.
- **Behaviour change (bug #17, href half).** The folder page now passes selected and drop-target ids in the `hrefKey`
  space, so a selection whose casing differs from the provider's href paints as selected there too (it already counted
  for menus and drags).
- **Live check (cold start, after US-1960):** with category Delta added through the facade, the Link category panel
  shows it at once (before the fix: Gamma never appeared). Folder page menus for a file, a folder, a two-item selection
  and the background, the selection set and the folder fingerprint identical; Explorer file, folder, two-item and
  background menus identical, Explorer rows identical (pooled row order only). Revealing an upper-cased path selects
  and paints the row in both the Explorer tree and the folder page.
- **US-1961.** Corrections: key dispatch stays host-owned (the controller supplies `isEditableTarget` and the actions;
  the folder page gains no F2 or Ctrl+C/X/V, the tree keeps its root-aware gates); both plural-target rules,
  right-click-outside-selection behaviour, event target and parent-callback payloads recorded and kept per host; the
  OS-drag gates of both copies listed and kept, with policy and `api.startOsFileDrag` in the controller and the
  `onDragStartOverride` wiring left at each view's extension point; a concrete `DropTargetTracker` API mapped to every
  counter/timer line of `TreeDndModel` and `CategoryViewModel`. `TreeProviderViewModel.ts` 1,309 → 1,139,
  `CategoryViewModel.ts` 787 → 638.
- **Behaviour change (D9, folder page).** A context menu on a multi-selection now also runs the `linkContextMenu`
  layer with the right-clicked item as target, as the Explorer tree does: a two-file selection shows Copy Paths (2),
  Cut (2), Copy (2), Delete (2), Open in New Tab, Open in New Window, Open with, Show in File Explorer, Inspect (before:
  the four plural items and Inspect). The folder page still has no parent-callback layer.
- **Live check (cold start, in a separate test window, after US-1961):** folder-page file, folder and background menus,
  selection and fingerprint identical; the two-item menu differs exactly by the D9 items; Explorer file, folder,
  two-item and background menus and rows identical. Drag hover with a synthetic file drag: a folder row and the
  whitespace target light up on enter, survive a nested child enter/leave and clear on leave, in the folder page and
  the tree. Not verified live: an actual drop and an OS drag-out (they need real input; the code paths moved unchanged
  behind the controller and tracker).
- **During the run** someone closed the test pages left open in the main window (answering their unsaved-changes
  dialogs), so the last checks ran in a separate window, closed afterwards.
- **Completion (2026-11-14).** `/review` (Codex): no code defects; it flagged UTF-8 BOMs on `CategoryViewModel.ts` and
  `TreeProviderViewModel.ts`. Both files had also been double-encoded by the US-1961 implementation run (23 comment
  lines with `â€”`); they were restored byte-exactly (cp1252 reversal, BOM dropped) and typecheck and lint re-run.
  `/document` updated `context-menu.md`, `folder-structure.md`, `key-files.md`, `overview.md`,
  `pages-architecture.md`, `secondary-views.md` and `trait-system.md`; `/userdoc` updated
  `assets/guides/editors/folder.md` (the multi-selection menu). No English catalog message changed;
  `i18n:check` reports every pack complete (1672/1672). Roadmap item 6.6 is complete; next: 6.7 part 2 (UIK-2).
