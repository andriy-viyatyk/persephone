# EPIC-173: Refactoring Phase 6.7 part 5 and 6.8 part 1 — components model generations, page-manager splitter, one file list, script engine and library

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-third epic of the [refactoring roadmap](../reviews/refactoring-roadmap.md). It closes roadmap item **6.7,
Tree and UIKit**, with finding **UIK-12** (`components/` mixes model generations; two migrations are half done:
FileList → FileGrid and `ImperativeSplitter` vs `SplitterView`) in `doc/reviews/refactoring-2026-11/09-uikit.md`.
UIK-12 is three tasks, so this epic also takes an independent first slice of item **6.8, Shell and scripting**:
finding **SHL-11** (the runner "hierarchy", duplicated library preparation, script globals in three places) plus the
scripting entries of **SHL-13** (dead code) in `doc/reviews/refactoring-2026-11/10-shell-scripting.md`.

The code was checked on 2026-11-14, after EPIC-172. The findings hold, with drift:

- **UIK-12 step 1.** `FileSearchModel.ts:110`, `GitBranchesModel.ts:55` (and the other two git models) still keep a
  private `disposed` flag; `TModel` (`core/state/model.ts:22`) already offers `disposables` and `isLive`.
- **UIK-12 steps 2–3.** `ImperativeSplitter.ts` (144 lines) still builds its element with
  `Object.assign(style, {…})` and `var(--color-bg-dark)`; `GroupContainer.ts:21` and `PageSlot.ts:15` keep their own
  `disposed` flags; `AppPageManagerView.ts` is 462 lines.
- **UIK-12 step 4.** `file-list/FileListView.ts` (ListBox, 214 lines) serves `ui/sidebar/RecentFileListView.ts` and
  `editors/git-tree/CommitDiffPanel.ts`; `file-grid/FileGridView.ts` (DataGrid, 115 lines) serves the Git Changes
  panel. `components/CLAUDE.md:13` and `standards/uikit-vs-components-split.md:27` call FileGrid "the eventual
  FileList replacement". FileList has features FileGrid lacks (search, `selectedPath`, icon override, per-item context
  menu, trailing slot as `SlotContent`).
- **SHL-11.** `ScriptRunnerBase` still has one subclass and holds `SCRIPT_PREFIX`; `library-require.ts:16` holds
  `MODULE_CONTEXT_PREFIX`; `handlePromiseException` is still read by `GlobalEventService.ts:253`.
  `script-utils.ts:2,9` filters stack frames by the file name `ScriptRunnerBase.ts`, so moving the execution code
  changes a load-bearing string. **Drift:** bug #7 (library path kept after a folder change) is already fixed:
  `registerLibraryExtensions` watches `script-library.path` (`library-require.ts:44`).

## Goals

- **UIK-12 step 1.** `FileSearchModel`, `GitTreeModel`, `GitChangesModel` and `GitBranchesModel` extend
  `TModel<State>` and use its `disposables` and `isLive`; their private `disposed`/`DisposableStore` fields are gone.
- **UIK-12 steps 2–3.** The page-manager splitter is a `SplitterView` (or a shared splitter handle from it) plus a
  small `SplitLayout` controller that owns pane positions; its styles live in `AppPageManagerView.css` with theme
  variables; the hand-rolled try/collect-first-error cleanup loops become a `DisposableStore` per page slot.
- **UIK-12 step 4.** One flat file-list implementation (see decisions).
- **SHL-11 + SHL-13 (scripting).** `scripting/script-engine.ts` (pure compile/execute), `scripting/ScriptLibrary.ts`
  (sucrase loading, extension registration, dirty flag, cache clear, `prepare()`), `ScriptRunner` and
  `AutoloadRunner` on both, `ScriptRunnerBase` deleted; one `SCRIPT_GLOBALS` list generating both prefixes;
  `ScriptContext` takes an explicit origin; `handlePromiseException` replaced; dead `run()`, `_releaseList` and stale
  comments removed.

## Decisions this epic acts on

- **Scope: five tasks.** UIK-12 as three tasks (models, page manager, file list); SHL-11 as two (engine and library;
  globals, context origin and the run counter). The rest of 6.8 (SHL-4, 6, 7, 8 and the non-scripting SHL-13 items)
  is part 2 of 6.8. SHL-11 was chosen as the first slice because it touches only `scripting/` and one line in
  `GlobalEventService`, with no overlap with the UIK-12 files.
- **Models (step 1).** Extending `TModel` must not change when callbacks are suppressed: every `if (this.disposed)`
  becomes `if (!this.isLive)` at the same point, and the dispose order stays (what each model cancels, sends or
  clears before its subscriptions go). A model whose state is not a single `TComponentState` is shown as such and the
  plan says how it maps. `PagePipeStatusModel` and `FileListModel` (driver-based `TComponentModel`) stay as they are.
- **Page manager (steps 2–3).** The absolute-positioning approach that avoids reparenting iframes and webviews is
  kept exactly: panes are never moved in the DOM, only positioned. Only who builds the splitter handle and who owns
  the positions changes. Pointer drag, double-click reset, the `paused` flag during compare mode, the resize observer
  and the stored width ratio keep their behaviour. If `SplitterView` cannot host an externally positioned handle
  without changing its public props, the plan extracts the shared drag behaviour into `uikit/Splitter` rather than
  bending `SplitterView`. No hard-coded colour; the `var(--color-bg-dark)` becomes CSS in `AppPageManagerView.css`.
- **One file list (step 4).** Default: **finish the migration** — Recent files and `CommitDiffPanel` move to
  `FileGridView` and `components/file-list/` is deleted — because two implementations of the same rows is the
  problem UIK-12 names. The planner first lists every FileList feature each consumer uses (search, `selectedPath`,
  icon override, per-item context menu, trailing slot, compact, keyboard, scrolling) and how FileGrid provides it
  (an existing prop, or a small optional prop). If a consumer would lose a feature FileGrid cannot gain without a
  second rendering path, the plan stops and keeps both, correcting the "eventual replacement" docs instead. Visible
  changes the migration brings (a header row, cell vs row focus) are listed and need my acceptance at plan review.
- **Script engine (SHL-11).** The implicit-return heuristics move **verbatim**; no change to which scripts return a
  value. The stack-frame filter in `script-utils.ts` is updated to the new file names in the same task, and the plan
  shows an error stack before/after. `ScriptLibrary` is a module-level singleton class owned by `scripting/`;
  autoload and user runs prepare the library through it. `SCRIPT_GLOBALS` lives in `ScriptContext.ts` and both
  prefixes are generated from it; the generated strings are shown equal to today's (order included).
  `ScriptContext` takes `{ origin: "user" | "agent" | "autoload", … }` instead of inferring MCP provenance from a
  console-log array; every constructor call site is listed with the origin it passes today.
- **Contracts that must not change:** the script API (`app`, `page`, `io`, facade member names, the globals a script
  and a library module see), `api/types/*.d.ts`, MCP `execute_script` results and logs, ai-vision paths, the
  `data-name` contract, persisted settings (`script-library.path`, the script panel cache key), page descriptors,
  `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1). No board rule moves (2). God files only shrink (3):
  `AppPageManagerView.ts`, `FileSearchModel.ts` and every touched view; line counts recorded as total and code-only;
  **comments are never deleted to reach a count**. Plans name the owner of every moved rule and the helper reused (4).
  No `await import()` to break a cycle (5); a pointless dynamic import is replaced by a static one only when it creates
  no cycle.
- **Order.** Wave 1 plans US-1979, US-1980 and US-1982 in parallel (different areas, starts staggered so runs do not
  share a run directory); implementations run one at a time. Wave 2 plans US-1981 (after US-1979, both touch
  `git-tree`) and US-1983 (after US-1982) against the landed code.
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent, on fixtures under `%TEMP%`; no page, dialog or window the agent did not open is touched, and
  the app is not restarted while other pages are open. `npm run build-prod` runs with `.vite/build` backed up and
  restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1979 | File-search and git models on `TModel` (UIK-12 step 1) | Done |
| US-1980 | Page-manager splitter on `SplitterView` + `SplitLayout`, per-slot `DisposableStore` (UIK-12 steps 2–3) | Done |
| US-1981 | One flat file list: FileList → FileGrid (UIK-12 step 4) | Done (kept both on purpose; shared row icon, docs corrected) |
| US-1982 | `script-engine.ts` and `ScriptLibrary`, `ScriptRunnerBase` deleted (SHL-11 steps 1–3) | Done |
| US-1983 | `SCRIPT_GLOBALS`, explicit `ScriptContext` origin, run counter, scripting dead code (SHL-11 steps 4–6, SHL-13) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts (total and code-only) before and
  after for every touched file over 300 lines. For every exported symbol that moves, is renamed or is deleted, list its
  importers and update them (no re-export shims). Every `data-name` and `data-*` attribute in a touched view listed and
  shown preserved. No unit tests or harnesses. Comments describing surviving code move with it.
- **US-1979.** Per model: state shape, every `disposed` check and what it guards, the dispose order before/after, and
  every external caller of `dispose()`.
- **US-1980.** The splitter's DOM and computed style before/after (position, width, cursor, colour, z-index), every
  pointer/resize/dblclick path, how `paused` is honoured, and the cleanup order of each replaced loop (which error is
  rethrown).
- **US-1981.** The feature table described in the decisions, the DOM and `data-name` of both consumers before/after,
  and every visible difference.
- **US-1982.** The moved heuristics side by side (proof of verbatim move), the stack filter before/after, the library
  dirty/cache-clear flow for user runs and autoload, and the autoload folder scan (once, not twice).
- **US-1983.** The generated prefixes before/after (string-equal), every `ScriptContext` construction site with its
  origin, and every reader of `handlePromiseException` with the replacement's timing (today's 1 s decrement window).

## Out of scope

- SHL-4, SHL-6, SHL-7, SHL-8 and the non-scripting SHL-13 items (6.8 part 2).
- Roadmap item 2.4 moves.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-172. Findings re-checked against the code (see Overview). Codex weekly window had 14% left
  and the 5-hour window 98%; the user asked for `--terra` on every planning run regardless (they reset the weekly
  limit when needed). Implementation and completion run on Luna.

### 2026-11-14 — wave 1 plans (US-1979, US-1980, US-1982)
- **US-1979** plan accepted. Drift found by the planner: `TModel` has no `isLive` (only `TComponentModel` does), so the
  flag moves to `TModel` and `TModel.dispose()` clears it first; no subclass declares its own `isLive` (checked).
  **Recorded difference:** a direct `TComponentModel.dispose()` call now also sets `isLive = false` (before only the
  driver's unmount did). Guards stay at the same points; `FileSearchModel` keeps its direct cancel on dispose.
- **US-1980 corrections sent:** the first plan kept a separate handle and extracted a `SplitterDrag` with "policies"
  reproducing the old handler's quirks, a `PopoverLayout` extraction and a store inside `PageSlot`. **Decisions:** the
  page handle *is* a `SplitterView` (`background: "dark"`, `hoverBackground: "light"`, `border: "none"`, which resolve
  to the same theme variables), positioned by app-layer CSS (`.pages-container > div > [data-type="splitter"]`) and an
  inline `left` written by `SplitLayout`, which keeps the old clamp (no `min`/`max` on the view, so narrow windows
  clamp exactly as before) and syncs `value` after every layout; double-click reset is a native `onDoubleClick` rest
  prop. No popover move (outside UIK-12, high risk) and no store in `PageSlot` (one ordered sequence, no loop); the
  three loops become `DisposableStore` batches (`GroupContainer` and `PageSlot` are already `IDisposable`).
  **Recorded differences:** the handle gains `SplitterView`'s DOM and ARIA (`splitter-root`, `data-type="splitter"`,
  `data-name="page-group-splitter"`, `role="separator"`, …); after pointer-up while still hovered it stays light until
  the pointer leaves; `pointercancel` ends a drag; reconcile runs all group validity checks before the group teardown
  (the checks read only the manager's maps, which teardown does not touch).
- **US-1982** plan accepted with its two decisions: autoload keeps CommonJS loading through `customRequire` and shares
  only `scriptLibrary.prepare()` (top-level scripts and modules are different contracts). **Recorded difference:** a
  non-empty autoload load now clears the dirty library cache (before, only user runs did), so changed transitive
  library dependencies load fresh on autoload reload. The stack filter's `SCRIPT_FRAME` regex is file-name agnostic;
  only the internal-path list changes to `script-engine.ts`. `ScriptRunner.run()` was already gone (finding drift).

### 2026-11-14 — US-1979, US-1980 and US-1981 results
- **US-1979 result:** `isLive` on `TModel`; `FileSearchModel` and the three git models extend `TModel` (no private
  `disposed`/store). `FileSearchModel.ts` 402 / 315 → 397 / 312. Live (test window, `%TEMP%` repo fixture): Git Tree
  commits, the Changes panel (2 unstaged), Branches and a file search ("v" → 3 matches) all load.
- **US-1980 result:** `SplitLayout.ts` (78 lines) owns ratio, observer, pause and positions; `GroupContainer` composes a
  `SplitterView`; `ImperativeSplitter.ts` deleted; the three cleanup loops are `DisposableStore` batches.
  `AppPageManagerView.ts` 462 / 391 → 444 / 374. Live, before/after in the test window: computed style identical
  (absolute, 8px, z-index 1, `ew-resize`, border-box, dark background); a trusted drag (`window.screen.dragTo`) moves
  the handle 150px with panes at 0/590 and 598; trusted double-click resets to 740; hover paints the light colour;
  compare mode hides the handle and exit restores it at the kept ratio; ungroup removes it, regroup recreates it; no
  page errors. (Synthetic `PointerEvent`s no longer drag because `SplitterView` checks pointer capture — expected.)
- **US-1981 decision: keep both, on purpose.** Codex's migration plan showed FileGrid lacks search, the selected-path
  highlight, item menus with root fallback, a `SlotContent` trailing slot, an empty message and Enter activation, and
  DataGrid cannot hide its header; migrating would add a header, sortable columns, cell focus and taller rows to the
  Recent files list and the commit diff list and re-implement the list features in two new collaborators. I rejected
  those visible changes (the epic made them my call). FileList is a click-to-open list, FileGrid a multi-select grid.
  Done instead (by me, a few lines): one `createFileRowIconElement` in `components/icons/icon-elements.ts` used by both,
  and the "eventual FileList replacement" claim corrected in `components/CLAUDE.md` and
  `uikit-vs-components-split.md` (which also named the wrong FileList consumer). Recent files and commit diff list
  fingerprints identical at top, middle, bottom and back.
- **US-1982 result:** `scripting/script-engine.ts` (`scriptEngine.compile`/`execute`, heuristics and `SCRIPT_PREFIX`
  moved verbatim — checked by diffing the old and new bodies), `scripting/ScriptLibrary.ts` (`scriptLibrary`: sucrase
  loading, `transpileIfNeeded`, dirty flag, `prepare()`; `library-require.ts` receives the transform getter, so no
  cycle), `ScriptRunnerBase.ts` deleted, `AutoloadRunner` calls `scriptLibrary.prepare()`, `library-service.ts`
  invalidates `scriptLibrary`, `script-utils.ts` filters `script-engine.ts`. I restored the dropped "two injection
  mechanisms" comment on `ScriptEngine`. Live (test window): a 15-script battery (expressions, statements, explicit
  return, trailing expression after a block, nested function, `await`, thrown errors with `script:line:col` frames,
  globals) gives the expected results; with `script-library.path` toggled to a `%TEMP%` library and restored to `""`,
  `require("library/utils/math")` works and a change to its transitive `library/utils/base` dependency is picked up
  on the next run. Noted, not changed: a relative `require("./x")` inside a library module fails because the module
  prefix replaces `require` with the context's `customRequire` (existing behaviour). Not exercised live: autoload
  (needs an app reload) — manual check.
- **US-1983 corrections sent:** the plan threaded the globals list through `prepare()`, `execute()` and
  `registerLibraryExtensions` to avoid a real cycle (`ScriptContext` → `AppWrapper` → `ai-vision/root` →
  `ScriptRunner`). **Decision:** a leaf `scripting/script-globals.ts` with no runtime imports (a type-only
  `keyof ScriptContext` check) owns `SCRIPT_GLOBALS` and both generated prefixes, so the roadmap's "export from
  `ScriptContext`" is not followed, on purpose. Board calls get their own `"board"` origin (not `"user"`); the counter
  getter is `inRejectionWindow` (it includes the named 1 s `SCRIPT_REJECTION_GRACE_MS`). Planner drift findings:
  `renderer-script-target.ts` already had no adapter cast, and `api/ui.ts` offers `ui.textDialog`.
- **US-1983 result:** `scripting/script-globals.ts` (32 lines, type-only import) generates both prefixes from
  `SCRIPT_GLOBALS` (string-equal to the old literals, checked by the implementer); `new ScriptContext({ page, origin,
  consoleLogs, libraryPath, tipCollector })` with `"user" | "agent" | "autoload" | "board"`; `scriptRunner
  .inRejectionWindow` with `SCRIPT_REJECTION_GRACE_MS`; `runWithResult(script, page, language)`; `ui.textDialog`
  instead of a dynamic `ui/dialogs` import; the dynamic `ScriptContext` import stays, with its cycle as a comment;
  `_releaseList` and the SF2/LV9 comment removed. I restored the surviving "agent runs mark browser pages opened by
  agent" fact as a comment and documented the getter's grace window. Live: the 15-script battery is identical to the
  US-1982 run; a page `runScript()` on a `%TEMP%` `.js` file writes "42" to its grouped page; an unhandled rejection
  during a run shows the "Unhandled promise rejection" notification; a library module sees `app`, `page`, `io`,
  `styledText`, `preventOutput`, `require`, `console` (setting toggled and restored to `""`). Not exercised live:
  a board `call`, autoload — manual checks.

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` found nothing. `/document` updated `folder-structure.md`,
  `key-files.md`, `pages-architecture.md` and `state-management.md`. `/userdoc` updated `scripting/index.md` (autoload
  reload refreshes library modules) and `whats-new.md`. No English catalog message changed.
- **Bug found and fixed (by me):** `/userdoc` had rewritten the guide's "relative requires within library modules work
  as expected" into "not supported", because my live check showed `import … from "./base"` inside a library module
  failing. That was a pre-existing bug (since US-236): the module prefix replaced the CommonJS wrapper's own `require`
  with the context's `customRequire`, which resolves ids against the renderer, not the module. Fix:
  `ScriptContext.moduleRequire(ownRequire)` sends `./`/`../` ids to the module's own `require` (fresh for files inside
  the library, with the context active) and everything else to `customRequire`; `script-globals.ts` binds
  `require=__ctx?__ctx.moduleRequire(require):require` in the module prefix (so the module prefix is no longer
  string-equal to the old one — on purpose). The guide line is restored and `whats-new.md` mentions the fix. Live:
  `./base`, `../utils/kinds` (with all seven globals), a later edit to `base.ts` picked up, `require("path")` unchanged.
- **Not verified live** (the user may be working in the main window, so the app was not restarted and checks ran in a
  separate test window): cold start; autoload loading and reload; a board `call`; the page splitter in a narrow window
  and with a webview/board iframe on one side (no reload expected: panes are never reparented).
