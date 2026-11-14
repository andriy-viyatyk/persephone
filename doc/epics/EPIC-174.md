# EPIC-174: Refactoring Phase 6.8 part 2 — tab state, editor titles and audibility, board identity, main page layout, menu-bar folder table

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-fourth epic of the [refactoring roadmap](../refactoring-roadmap.md). It continues roadmap item
**6.8, Shell and scripting**, after [EPIC-173](EPIC-173.md) (part 1: SHL-11 and the scripting items of SHL-13). The
findings are in `doc/reviews/refactoring-2026-11/10-shell-scripting.md`: **SHL-4** (tab presentation and tab-action
rules live in `PageTabView` and are re-derived elsewhere), **SHL-6** (board name and glyph resolution repeated in six
shell views with private manifest caches), **SHL-7** (`MainPageView` mixes layout with feature work), **SHL-8**
(`MenuBarView` builds the same configuration twice and owns folder actions) and the non-dialog shell items of
**SHL-13** (dead code and stale leftovers).

The code was checked on 2026-11-14, after EPIC-173. The findings hold, with drift:

- **SHL-4.** `ui/tabs/PageTabView.ts` is 763 lines with its own `EditorTabState` projection; `_anyTabAudible` lives in
  `browser-state.ts` and is read through casts in `PageTabView.ts:40,89,413-448` and `ai-vision/page-tab.ts:66-68`;
  `BoardEditorModel`/`BoardFrameChrome` expose `toggleMuteAll` as a getter, `BrowserTabsModel` and `VideoEditor` as an
  arrow field. `isLockedBoardPage`/`pinSide` guards are repeated in `PagesLayoutModel` and `PagesLifecycleModel`.
  `PagesView.ts:80,94` still writes `popoverSize` and sends `pages.onFocus`. `ui/tabs/page-title.ts` (31 lines) is
  the stringly-typed title chain.
- **SHL-6.** `boardDisplayText(root, …, boardMetadataKeys.name, …)` appears in `PageTabsView`, `MainPageView`,
  `EditorCategoriesView`, `EditorsTreeView`, `EditorCategoriesPopoverView` and `page-title.ts`; `PageTabsView` and
  `OpenTabsListView` each keep a `warmedBoardRoots` cache.
- **SHL-7.** `MainPageView.ts` is 470 lines. **Drift:** voice typing is already a `VoiceTypingService` started by
  bootstrap (EPIC-162); the view only mounts `VoiceTypingOverlayView`. `runSnip`, the audio-capture count with its
  revision guard, global mute, `refreshBoardIdentity` and `hiddenChromeState` are still in the view.
- **SHL-8.** `MenuBarView.ts` is 594 lines; `isStaticFolder` (`:55`) is still an alias of `isBuiltinFolder`.
- **SHL-13 (shell).** **Drift:** `pinned-items.ts`, `LiveSpeechSessionCoordinator.isBusy` and
  `SpeechTranscriptionProvider.open` are already gone. Still present: `PageTabsView.updateTabs`/`refreshTabLayout`
  near-duplicates and the hardcoded 208 px locked-tab width (`:240`); `displayName`/`routeFor` aliases in
  `TranslateTextPageController.ts:38-42`; `isStaticFolder`; raw `require("electron").ipcRenderer` in
  `editors/board/board-dialogs.ts` and `api/speech/microphone-settings.ts` (the planner re-checks `TorInfoDialog`).
  The dialog items (`Dialogs.ts`, `Poppers.ts`, the `ui/dialogs/index.ts` barrel with about 20 importers,
  `ModelViewSlotHost`, `onDialogClosed`) are left for part 3, because they belong with roadmap item 2.2's dialog slice
  (`api/dialogs`).

## Goals

- **SHL-6.** One `boardIdentity` service (`displayName(root)` warming lazily with a fallback, `glyph(root, size?)`,
  `onChanged(listener)` merging the text and icon events) used by every shell view; the per-view caches are deleted.
  The board window's title and identity IPC move from `MainPageView` to a `BoardWindowIdentity` service that bootstrap
  starts in board mode (it owns `document.title`, `setBoardWindowIdentity` and the revision guard).
- **SHL-4 steps 1 and 4.** A `PageTabState` projection on `PageModel` (title, active, grouped, popover, sound,
  `can*` predicates) read by `PageTabView`, `OpenTabsListView` and the ai-vision `PageTabNode`; the model guards in
  `PagesLayoutModel`/`PagesLifecycleModel` call the same predicates; popover focus and size go through `PagesModel`;
  the four untranslated tab-menu strings go through `t()`.
- **SHL-4 steps 2 and 3.** `EditorModel.displayTitle` (default `title`, overrides in the editors that need one;
  the board override uses `boardIdentity`) replaces `page-title.ts`; an optional `IAudibleEditor` contract replaces
  `_anyTabAudible` reads and the duck-typed `toggleMuteAll` lookups.
- **SHL-7.** `MainPageView` is layout only: `app.shell.snipToNewPage`, an `audioCaptureState` next to
  `globalMuteClient`, `HeaderStatusIndicatorsView` (reads a hide flag from recording state) and
  `RecordingControlsView`, and two header compositions (`AppHeaderView`, `BoardWindowHeaderView`) instead of
  `isBoardMode` branches.
- **SHL-8 + SHL-13 (shell).** One `BUILTIN_FOLDER_UI` table plus a generic user-folder entry in `MenuBarView`; the
  ListBox is built once from `folderListProps()`; library-folder and folder-add actions move to their services; right
  views expose a `showSearch()` interface instead of `instanceof`; the small dead aliases and raw IPC calls listed
  above are removed.

## Decisions this epic acts on

- **Scope: five tasks.** SHL-4 is split in two (shell-side projection; editor-side contract), because the editor
  contract touches eight editors and needs `boardIdentity` first. SHL-13's dialog items move to part 3 with roadmap
  item 2.2's dialog slice. Item 6.9 is not part of this epic.
- **Owners.** `boardIdentity` lives in `api/boards/` next to the board display-text owner if that is where
  `boardDisplayText`/`ensureBoardDisplayText` live today, otherwise next to them (the planner names the file it reuses;
  no second manifest cache). `BoardWindowIdentity` lives in `api/window/` or the existing window module the planner
  finds, and is started from the bootstrap service table, not from a view. `PageTabState` and the `can*` predicates
  are owned by `api/pages/` (the page model or a small pure module it uses); views only read. `IAudibleEditor` is
  declared in `editors/base/` and implemented by the editors that own audio. Folder actions are owned by
  `api/library-service.ts` and the menu-folders service.
- **Behaviour.** No visible change unless recorded: the same tab titles, menu items and their order, enabled states,
  drag rules, sound-button visibility and click behaviour, popover focus timing, header widget order and visibility
  in both app and board mode, menu-bar labels, icons, tooltips and context menus. Every `if`/guard that moves keeps its
  condition; a plan that simplifies a condition lists it as a recorded change for my acceptance. The four tab-menu
  strings and the three menu-bar tooltips become catalog messages with the same English text.
- **Contracts that must not change:** the script API (`app`, `page`, `io`, facade member names), `api/types/*.d.ts`,
  ai-vision paths and node names (`page-tab.ts`), MCP `call` results, the `data-name` contract
  (`architecture/ui-element-contract.md`), persisted settings and page descriptors, the board window identity IPC
  payload, `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1): the identity IPC and audio-capture count reuse their existing channels. No
  board rule moves out of `shared/board/` and the board registries (2); `boardIdentity` composes the existing
  display-text helpers. God files only shrink (3): `PageTabView.ts`, `PageTabsView.ts`, `MainPageView.ts`,
  `MenuBarView.ts`, `PageModel.ts`, `PagesLifecycleModel.ts`; line counts recorded as total and code-only;
  **comments are never deleted to reach a count**. Plans name the owner of every moved rule and the helper reused (4).
  No `await import()` to break a cycle (5).
- **Order.** Wave 1 plans US-1984 (board identity), US-1985 (tab state) and US-1988 (menu bar) in parallel, with
  staggered starts; implementations run one at a time (US-1984 first). Wave 2 plans US-1986 (titles and audibility,
  after US-1984 and US-1985) and US-1987 (main page, after US-1984) against the landed code.
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent, on fixtures under `%TEMP%`; no page, dialog or window the agent did not open is touched, and
  the app is not restarted while other pages are open. `npm run build-prod` runs with `.vite/build` backed up and
  restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1984 | `boardIdentity` service and `BoardWindowIdentity` (SHL-6) | Done |
| US-1985 | `PageTabState` projection, shared tab-action predicates, popover focus in `PagesModel` (SHL-4 steps 1, 4; SHL-13 tabs) | Done |
| US-1986 | `EditorModel.displayTitle` and `IAudibleEditor` (SHL-4 steps 2–3) | Done |
| US-1987 | `MainPageView` reduced to layout (SHL-7) | Done |
| US-1988 | `MenuBarView` folder-UI table and shell dead code (SHL-8, SHL-13 shell items) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts (total and code-only) before and
  after for every touched file over 300 lines. For every exported symbol that moves, is renamed or is deleted, list its
  importers and update them (no re-export shims). Every `data-name` and `data-*` attribute in a touched view listed and
  shown preserved. No unit tests or harnesses. Comments describing surviving code move with it.
- **US-1984.** Every `boardDisplayText`/glyph call site and which event it listens to today; the warming and
  invalidation flow (`reason === "invalidate"`) before/after; the board window title and identity IPC sequence and
  revision guard before/after.
- **US-1985.** Every tab-menu item with its availability condition before/after (side by side), every drag rule, the
  "active including grouped partner" rule, and every model guard that will call a shared predicate. The popover
  focus/size sequence before/after.
- **US-1986.** Every branch of `displayPageTitle` mapped to the editor override that replaces it, with the English
  title strings it matched; every audibility reader and writer (`_anyTabAudible`, `pageMuted`, `toggleMuteAll`) and
  how `IAudibleEditor` serves it; the facade member names unchanged.
- **US-1987.** The header DOM in app mode and board mode before/after (element order, `data-name`, `hidden`), the
  recording hide/restore sequence, the audio-capture revision guard, and the snip flow.
- **US-1988.** Per built-in folder: label, icon, tooltip, context menu, right view and its props before/after; the
  library and folder actions moved with their callers.

## Out of scope

- SHL-13 dialog items (`Dialogs.ts`, `Poppers.ts`, the `ui/dialogs` barrel, `ModelViewSlotHost`, `onDialogClosed`):
  6.8 part 3, with roadmap item 2.2's dialog slice.
- Roadmap items 2.2 and 2.4 moves, and item 6.9.
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-173. Findings re-checked against the code (see Overview). Codex weekly window had 11% left
  and the 5-hour window 77%; per the user, planning runs on `--terra` regardless (a limit reset is available), and
  implementation and completion run on Luna.

### 2026-11-14 — plans (wave 1: US-1984, US-1985, US-1988; wave 2: US-1986, US-1987)
- **US-1984 corrections sent:** the plan put `boardIdentity` in `api/boards/` and the window identity in `api/window/`
  with a startup-table row, but `api/` importing `editors/board/` is an error-level import zone. **Decisions:** both live
  in `editors/board/` (`board-identity.ts`, `board-window-identity.ts`); the window identity is installed by
  `src/renderer/index.ts` `mount()` like the other `install*` functions (same lifetime as the old view code, so no
  earlier start); the warm state lives in `BoardIdentity`, and `board-display-text.ts` is unchanged. Accepted:
  `displayName(root, fallback?)` plus `manifestName(root)` (the call sites use different fallbacks), and shared lazy
  warming (names may localize earlier in the category, tree and popover surfaces).
- **US-1985 corrections sent:** the projection must not import `ui/` or `editors/board/`, so the title stayed in the
  views until US-1986; the 208 px locked-tab width is a named constant in `PageTab.ts` mirroring the CSS (no runtime
  measurement); menu-only conditions are one `tabMenuAvailability(page, mode)` object, model guards keep their
  distinct predicates. Accepted: `pages.popoverTransitioned(previousId, nextId)`, called by `PagesView` after the
  manager/listener update to keep today's focus ordering. Planner drift: the four tab-menu strings were already
  localized.
- **US-1988 corrections sent:** the raw-IPC item was **decided against**: raw `ipcRenderer` on dedicated channels is the
  pattern in about 20 renderer modules, and `ipc/renderer/api.ts` is a request/reply proxy with a 30 s deadline, so
  moving three callers would change timeout semantics or mix two transports in one module. Planner drift: the three
  untranslated menu-bar tooltips no longer exist (current tooltips kept).
- **US-1987 corrections sent:** the plan kept constructing the app-only widgets detached in board windows; decision:
  two real compositions, with `GlobalMuteButtonView` shared. **Recorded change:** board windows no longer construct the
  app-only header widgets (not observable: detached nodes are outside the document). Accepted: independent hide/restore
  snapshots in `RecordingControlsView` and `HeaderStatusIndicatorsView` (same saved-value semantics), an internal
  `api/shell/snip-to-new-page.ts` (no `app.shell` member), `api/audio-capture-state.ts` per app header.
- **US-1986 corrections sent:** `EditorModel.displayTitle` already exists as a raw name/path (board sources, Board Info
  path comparisons, exports), so it was not repurposed; the plan then added per-editor `tabTitle` getters **and** a
  descriptor registry for other windows' rows (two dispatch paths). Decision: one `editors/tab-title-registry.ts`
  (beside `register-editors.ts`, since `editors/base` may not import board modules) dispatching to per-editor
  `*-tab-title.ts` formatters, used by the tab and the sidebar for live and remote rows; no getter. **Bug found:**
  EPIC-158 (`568dde2e`) deleted `BrowserEditor.toggleMuteAll`, so the browser tab's sound button did nothing when
  clicked. Fixed with an explicit `IAudibleEditor { audible, muted, soundButtonWhenSilent, toggleMuteAll() }`, which also
  keeps every editor's button visibility unchanged (board: only while the board asked for it; video: always; browser:
  while audible or muted).

### 2026-11-14 — results
- **US-1984:** `PageTabsView` 418 → 393, `MainPageView` 470 → 423 at that point; per-view caches gone. Live (test
  window): tab titles, tab menus and menu-bar folders identical to the baseline; the editor-categories popover lists
  board names with glyphs; a board-mode window's header DOM and `document.title` identical.
- **US-1985:** `api/pages/page-tab-state.ts` (type-only imports), `PageTabsView` one `renderTabs`. Live: titles and
  every tab menu identical; pin left/right menus, popover open/close and unpin; the grouped partner reads active in the
  tab strip and in ai-vision `pages[i].tab.active`.
- **US-1988:** `ui/sidebar/menu-bar-folder-ui.ts`, `libraryService.choose()/unlink()`, `menuFolders.addWithDialog()`;
  `MenuBarView` 594 → 400. Live: folder rows and every folder context menu identical; Ctrl+F opens the Recent files
  search; Add Folder shows "Select Folder to Add" and cancelling adds nothing.
- **US-1987:** `MainPageView` 67 lines; `AppHeaderView`, `BoardWindowHeaderView`, `GlobalMuteButtonView`,
  `HeaderStatusIndicatorsView`, `RecordingControlsView`, `header-buttons.ts`. I restored three comments the
  implementer dropped. Live: app header and board-window header DOM identical to the baseline (only the MCP connection
  count differs); recording with `hideStatusChrome` hides the controls and the MCP indicator and restores them on stop;
  record/pause/stop show the expected buttons.
- **US-1986:** 12 formatter modules + registry, `page-title.ts` deleted, `editors/base/audible-editor.ts`.
  `/review` replaced the formatter's runtime `BoardEditorModel` import with a structural check keyed on
  `state.editor === boardView` (equivalent: a board acting as a custom editor or anchored to a folder already fails the
  `!filePath && !folderAnchor` test). **Recorded change:** formatting a board tab title warms its manifest lazily
  through `boardIdentity` (same as US-1984). Live: titles identical after a full reload; ai-vision tab nodes report the
  same titles, active and sound state.
- **Not verified live:** translated titles in another UI language (it is a global setting the user's window shares);
  the browser mute click (needs an audible page); the video and board sound buttons; snip (native capture UI); popover
  focus ordering (internal event); other windows' rows in Open Tabs. A hidden-chrome recording started through a direct
  MCP call once stalled at "ready" right after the window was reopened, then worked from a script; a renderer reload
  mid-start left main's session active until the window was reopened (pre-existing, not in this epic's code).

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` made the structural board-check fix above and found nothing else.
  `/document` updated `overview.md`, `pages-architecture.md`, `editors.md`, `folder-structure.md` and `key-files.md`.
  `/userdoc` changed nothing. No English catalog message changed; `npm run i18n:check` reports every pack complete.
