# EPIC-176: Refactoring Phase 2.2 (rest) — secondary-view host out of ui/, translation services and Monaco contributions, editor-catalog views, ui/ import lock

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-sixth epic of the [refactoring roadmap](../reviews/refactoring-roadmap.md). It finishes roadmap item
**2.2, Make `ui/` a pure view layer** (SHL-1, SHL-5), after the speech/DSP slice ([EPIC-162](EPIC-162.md)) and the
dialog slice ([EPIC-175](EPIC-175.md)). Findings: `doc/reviews/refactoring-2026-11/10-shell-scripting.md` (SHL-1,
SHL-5).

The code was checked on 2026-11-14, after EPIC-175. Row 2.2 has drifted; part of it is already done:

- **Already done.** `SecondaryViewsModel` and `panel-key` live in `api/pages/` (`api/pages/SecondaryViewsModel.ts`,
  `api/pages/panel-key.ts`); the editor-category rules live in `api/editor-categories.ts`; dialog models in
  `api/dialogs/` (EPIC-175); speech services in `api/speech/` and DSP in `audio/dsp/` (EPIC-162). `api/` imports
  nothing from `ui/` statically.
- **Still open — 41 imports of `ui/` from outside it** (`src/renderer/index.ts`, the shell composition root, excluded):
  - **Secondary-view host (27).** `ui/secondary-views/secondary-view-registry.ts` (96 lines; `SecondaryViewProps`,
    the panel-id → loader registry) is imported by 12 editor secondary views, `editors/register-editors.ts` and
    `scripting/ai-vision/page-panels.ts`; `ui/secondary-views/SideBarPanelHeaderView.ts` (178, plus
    `SideBarPanelHeader.css`) by the same 12 editor views; `ui/secondary-views/SecondaryViewsView.ts` (385) by
    `editors/browser/BrowserSecondaryViews.ts` (and `ui/app/PageContentView.ts`); `LazySecondaryViewView.ts` (127) is
    internal to the host.
  - **Translation (7).** The services `ui/translation/TextTranslationProvider.ts` (233, module-service channel client)
    and `TranslationWorkflow.ts` (101) are imported (5) by `editors/browser/BrowserTranslationController.ts`,
    `BrowserPageTranslationController.ts`, `BrowserTranslationPopoverContentView.ts` and
    `editors/settings/sections/BrowserProfilesSection.ts`. The Monaco contribution — `TranslateTextPageController.ts`
    (280), `TranslateTextToolbarContributionView.ts` (73), `TranslateTextDialogView.ts` (118, registers through
    `api/dialogs/dialog-view-registry`) and `translate-text-segmentation.ts` (150) — is imported (2) by
    `editors/monaco/MonacoEditorView.ts`.
  - **Transcript (3, one type-only).** `ui/transcript/TranscriptController.ts` (243) and `TranscriptToolbarContributionView.ts` (132)
    are imported by `editors/monaco/MonacoEditorView.ts`.
  - **Editor-catalog views (3).** `editors/tools-hub/ToolsHubView.ts` imports `ui/sidebar/EditorsTreeView.ts` (357),
    `EditorCategoriesView.ts` (234) and `TrustedToolsListView.ts` (87). `EditorCategoryColumnListView.ts` (166) and
    `creatable-item-icon.ts` are shared with `ui/tabs/EditorCategoriesPopoverView.ts` and `ui/tabs/PageTabsView.ts`;
    `ui/sidebar/ToolsEditorsPanelView.ts` (the shell sidebar panel) also mounts the tree and trusted-tools views.
  - **Link context menus (1, lazy).** `api/app-startup.ts:186` registers `registerTreeContextMenuHandlers` through
    `await import("../ui/link-menus/tree-context-menus")` in the `event-registrations` startup step — an `api/` → `ui/`
    edge hidden behind a dynamic import (guardrail 5). `ui/link-menus/open-with-editor.ts` is shared with
    `ui/sidebar/RecentFileListView.ts`.
- The only lint lock today forbids `ui/dialogs` to `api/`, `content/`, `components/` and `scripting/` (and `ui/` to
  `api/capabilities/`). ESLint flat config replaces `import/no-restricted-paths` per matching block, so `api/**` files
  get their zones from the later US-1824 block (and its two ignored files only from the first) — a new zone must be
  present in every block that matches a file.

## Goals

- Nothing outside `ui/` (other than the composition roots `src/renderer/index.ts` and `src/renderer.ts`) imports
  `ui/`, statically or lazily, locked by an error-level import zone covering every other `src/renderer/` folder.
- `ui/` keeps only shell views and the shell's own wiring (`register-dialog-views.ts`, `board-dialog-controller.ts`,
  header and menu-bar tables, the link context-menu contributions it owns).
- No behaviour change; every moved file keeps its comments; no re-export shims.

## Decisions this epic acts on

- **Scope: three tasks.**
  - **US-1993 — secondary-view host.** `secondary-view-registry.ts`, `SecondaryViewsView.ts`,
    `LazySecondaryViewView.ts`, `SideBarPanelHeaderView.ts` and `SideBarPanelHeader.css` move to
    `editors/base/secondary-views/`. Owner: `editors/base/` already owns the editor chrome views (`EditorToolbarView`,
    `EditorStatusBarView`, `PageToolbarView`) and the editor registry; secondary views are editor-declared panels, and
    `ui/app/PageContentView.ts` imports them downward. Not `uikit/` (the header is app chrome with an app CSS file and
    no Storybook contract) and not `components/` (the host imports `editors/base/EditorModel`, which would add a
    `components/` → `editors/` edge). Not `api/pages` either: the registry holds view constructors, and `api/` holds no
    views. The `editors/base/**` zone (no board modules) must still pass.
  - **US-1994 — translation and transcript.** `TextTranslationProvider.ts` and `TranslationWorkflow.ts` move to
    `api/translation/` (the roadmap's service home). The Monaco contributions move to
    `editors/monaco/contributions/translate/` (`TranslateTextPageController`, `TranslateTextToolbarContributionView`,
    `TranslateTextDialogView` + CSS, `translate-text-segmentation`) and `editors/monaco/contributions/transcript/`
    (`TranscriptController`, `TranscriptToolbarContributionView` + CSS). `ui/translation/` and `ui/transcript/` are
    deleted.
  - **US-1995 — editor-catalog views, link menus, the lock.** `EditorsTreeView`, `EditorCategoriesView`,
    `EditorCategoryColumnListView`, `TrustedToolsListView` (with their CSS) and `creatable-item-icon.ts` move to
    `editors/tools-hub/` — the Tools & Editors editor owns its views, and the shell (`ui/sidebar/ToolsEditorsPanelView`,
    `ui/tabs/*`) imports them downward. Not `components/` (they import `editors/board/*` and `editors/tools/*`). The
    link context-menu registration leaves `api/app-startup.ts`: the shell registers its own contributions; the plan
    proves the `linkContextMenu` subscriber order (LIFO) and the registration time relative to the first possible
    context menu are unchanged. Then one error-level zone forbids `ui/` to `api`, `audio`, `automation`, `components`,
    `content`, `core`, `editors`, `scripting`, `theme`, `uikit`, `i18n` and `types`, proven with a temporary violating
    import, replacing the narrower `ui/dialogs` zones.
- **Pure moves.** Files move with `git mv`; importers are updated; no shim, no barrel. A lazy `import()` whose path
  changes stays lazy; no new `await import()`.
- **Behaviour.** No visible change: the same sidebar panels, headers, collapse and splitter behaviour, ai-vision
  `panels` paths, translate/transcript toolbar buttons, menus and dialogs, browser page translation, editor-catalog
  tree and categories, link context menus. Every `if`/guard that moves keeps its condition; a plan that changes one
  lists it as a recorded change.
- **Contracts that must not change:** the script API, `api/types/*.d.ts`, ai-vision paths and agent-facing messages,
  MCP `call` results, the `data-name` contract, persisted settings and `uiPreferences` keys, `window.persephone` (not
  touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1). No board rule moves out of `shared/board/` and the board registries (2).
  God files only shrink (3). Plans name the owner of every moved file and the helper reused (4). No `await import()`
  to break a cycle (5). Error-level import zones in `eslint.config.mjs` must pass.
- **Order.** The three plans are written in parallel (staggered starts, each touching only its own task document) and
  implemented one at a time, US-1993 → US-1994 → US-1995, because US-1995's lock needs the other two landed.
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent; no page, dialog or window the agent did not open is touched, and the app is not restarted
  while other windows are open. `npm run build-prod` runs with `.vite/build` backed up and restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1993 | Secondary-view host to `editors/base/secondary-views` | Done |
| US-1994 | Translation services to `api/translation`, translate and transcript to `editors/monaco/contributions` | Done |
| US-1995 | Editor-catalog views to `editors/tools-hub`, shell-owned link menus, `ui/` import lock | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved file and the helper reused. For every exported symbol that moves,
  list its importers and update them (no re-export shims). Check every new import against the error-level zones in
  `eslint.config.mjs` and against the target layer map (roadmap §4.1); list any new import edge between top-level
  folders. Static vs lazy: keep each import's kind. No unit tests. Comments move with the code.
- **US-1993.** Whether `SecondaryViewsView`/`LazySecondaryViewView` pull anything into `editors/base/` that the base
  zone forbids; the CSS import path; the docs that name the old paths (for `/document`, not this task).
- **US-1994.** The module-service channel client's lifetime (singleton creation and first use) before/after; that
  `api/translation/` imports no view and no `editors/`; the translate dialog's view registration site.
- **US-1995.** The `linkContextMenu` subscribers and their registration order before/after; when the new
  registration runs relative to the first possible link context menu (tree panels, recent files, link editor); the
  ESLint block-override semantics for the lock; the before/after count of outside → `ui/` imports (41 → 0).

## Out of scope

- Phase 7 (lint warnings → errors for every zone, `overview.md` dependency-rule rewrite, `strictNullChecks`).
- Roadmap 2.3 (`core/` cleanup, content menus out of `content/`) and 2.4.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-175. Findings re-checked against the code (see Overview). Codex weekly window had 3% left
  and the 5-hour window 99%; planning runs on `--terra` (the user has a limit reset available), implementation and
  completion on Luna.

### 2026-11-14 — plans
- The three plans were written in parallel (Codex, Terra) and checked against the source: every importer list, the
  `EditorModelInstance` export the registry now imports directly, the `linkContextMenu` subscriber set (only the three
  built-in handlers in `tree-context-menus.ts`), the bootstrap order (`renderer.ts` starts the index import, the
  `bootstrap` startup row awaits it before `services`/`events`), `app.events` being constructed with `app`, and the
  ESLint flat-config override semantics. No corrections were needed. **Decided:** the link-menu registration moves to
  `index.ts` module level next to `registerDialogViews()`, not to `mount()`: module level keeps the built-in handlers the
  earliest-registered `linkContextMenu` subscribers (LIFO), so autoload scripts still run before them; registering in
  `mount()` would have put the built-ins after autoload subscribers. **Recorded change:** registration now runs in the
  bootstrap phase instead of the events phase (no menu can open before mount either way).

### 2026-11-14 — results
- **US-1993:** five files to `editors/base/secondary-views/`, 16 importers updated (41 → 14 outside imports).
- **US-1994:** two services to `api/translation/`, eight files to `editors/monaco/contributions/` (14 → 4).
- **US-1995:** eight files to `editors/tools-hub/`, shell-owned link-menu registration, `uiImportZone` (4 → 0). I kept
  the Rule 6 comment the implementation had shortened and gave the zone an actionable message. The lock was proven
  with temporary violating imports (by the implementer in eight locations, and by me in `content/` and
  `editors/base/`).
- Every moved file differs from its original only in import paths (checked with a line-ending-insensitive diff); no BOM
  or mojibake.
- **Live (own window, closed afterwards):** after US-1993, a folder page's Explorer and Search panels render in the
  stack with headers, lazy hosts and the splitter, and expand/collapse. Persephone exited during US-1994 (not from a
  change: the cold `npm start` afterwards came up cleanly with US-1993 and US-1994 in place); after reopening, the
  Monaco page's transcript and translate toolbar DOM matched the baseline byte for byte, and a microphone transcript
  started (level meter, stop button) and stopped. After US-1995 and a full reload, the link context menus for an
  HTTP URL, a cURL link, a file and a folder (items and order) and the Tools & Editors hub (editors and tools tabs:
  element names, counts and tree text) matched the baselines; the new-tab editor-categories popover opens with its
  column list and closes on Escape.
- **Not verified live:** the translate dialog and browser page translation (no translation provider installed, so
  the toolbar is hidden), the browser profile translation targets in Settings, board/archive/git/link/mneme panels.
- **Builds:** `npm run typecheck`, `npm run lint`, `npm run build-prod` (with `.vite/build` backed up and restored) and
  `npm run i18n:check` pass.

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` found nothing to change. `/document` updated `folder-structure.md`,
  `key-files.md`, `overview.md` (dependency rules: `ui/` boundary enforced; I restored the note that the other rules
  are still targets), `secondary-views.md` and `editor-guide.md`. `/userdoc` changed nothing. No English catalog
  message changed; `npm run i18n:check` reports every pack complete.
