# US-1665: Layout fixes, lint rule to error, closing sweep

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implemented; post-change live inspection pending

## Goal

Fix clipping found during the EPIC-125 `en-XA` walk, promote the completed hardcoded UI string lint rule to an error while exempting the phase-3 board webview files, and record concise localization conventions plus final English catalog sizes for phase 4.

## Background

This is the closing task for EPIC-125, governed by decisions E1–E7. The extraction introduced typed flat catalogs under `src/shared/i18n/en/`, `t(key)` for displayed copy, `englishMessage(key)` for English agent/persisted values, `untranslated(text)` for deliberate English in UI positions, and stable menu/button identities independent of translated labels. `no-hardcoded-ui-strings` is currently a warning; US-1653 widened its visitor coverage, but positional-helper blind spots still require manual source review.

The live `en-XA` findings are in the Settings navigation tree and menu bar folder column. The relevant ellipsis rules are `src/renderer/uikit/Tree/TreeItem.css`, `src/renderer/editors/settings/settings.css`, `src/renderer/ui/sidebar/FolderItem.css`, `src/renderer/ui/app/HeaderQuickSettingsPopover.css`, and `src/renderer/ui/sidebar/PinnedRail.css`. Settings tree text supports `TreeProps.getTooltip`; ListBox rows support `getTooltip`. Settings paths already set `title`; page tabs already attach a full-title tooltip. The Commit, Create Board, and Create Board Variables Storage dialogs each request 520px width; their body content uses ordinary wrapping flow and does not impose `white-space: nowrap`.

### Before → after

Before, the Settings tree is only 220px wide and rows have no tooltip:

```ts
width: 220,
// contentTreeProps(): no getTooltip
```

After, widen it moderately and expose each complete rendered label:

```ts
width: 280,
getTooltip: (item: SettingsContentItem) => item.label,
```

Before, built-in menu folder records only expose a tooltip when `getFolderTooltip()` has a special value. After, the full visible folder label is the fallback tooltip, while custom folder paths retain their existing tooltip.

## Implementation Plan

- [x] Read `doc/agents-common.md`, `.claude/rules/task-docs.md`, `doc/standards/localization.md`, EPIC-125 decisions E1–E7 / US-1665 / “For the user to test”, the uikit authoring guide, and US-1653–US-1664 task patterns.
- [x] Audit `text-overflow: ellipsis` CSS and inline-style helpers in `src/renderer/ui/**` and `src/renderer/editors/settings/**`; identify existing tooltip/title coverage and distinguish displayed app text from data.
- [x] Inspect the body flow of all three 520px dialogs. They do not force message text to remain on one line, so no dialog layout edit is planned unless implementation evidence shows overflow.
- [x] Add full-label tooltips to Settings navigation rows, the View Settings File button, Menu Bar folder rows, clipped quick-settings labels, and pinned editor labels. Widen the Settings tree pane modestly.
- [x] In `eslint.config.mjs`, change `vanilla-view/no-hardcoded-ui-strings` from `warn` to `error`; add file exclusions for `src/board-context-menu.ts` and `src/board-shim.ts` in `isExcludedI18nFile()` with a phase-3 / roadmap D10 rationale comment.
- [x] Update `doc/standards/localization.md` with the established lint positions, E2 split, `untranslated()`, menu/button identity rules, uikit text table, Monaco allow-list, whole-sentence and plural rules, and positional-helper blind spot.
- [x] Count catalog entries in every `src/shared/i18n/en/*.ts` area file (excluding `index.ts`) and include the per-area table and total in this task's results.
- [x] Run `npm run lint`, `npm run typecheck`, and `npm run build-prod`; do not add or run tests/harnesses.
- [x] Record implementation, command outcomes, and final file list below. Do not edit `doc/epics/EPIC-125.md` or `doc/active-work.md`.

## Concerns

- Menu folder labels can represent paths or user-provided folder names. Preserve the existing path tooltip and use the complete visible label as the fallback, without changing row identity or data.
- Pinned board rows show path-derived board names; only app-owned editor labels should receive a new title.
- The board context menu and shim intentionally remain English until phase 3 provides the webview locale through D10. Keep their lint exemption file-scoped and documented.
- Live app interaction is not available to this task runner; the reported layout defects were verified live under `en-XA` before this task. The requested lint, typecheck, and production build remain the implementation verification.

## For the user to test

- In a dev build, select Pseudo-English (`en-XA`), open Settings, and inspect all left-tree group/section labels plus the View Settings File button. Hover clipped labels and confirm the title exposes the complete visible text.
- Open the menu bar's Tools & Editors folder and verify its full label tooltip. Inspect the quick-settings popover and pinned editor rail for full-label tooltips when labels clip.
- Exercise Commit, Create Board, and Create Board Variables Storage dialogs with long messages/validation text and confirm body text wraps inside the 520px width.

## Acceptance Criteria

- Settings navigation labels and the bottom View Settings File button expose their full text; the navigation pane is moderately wider and remains usable.
- Menu Bar folder labels and other app-text ellipsis sites in the audited UI/Settings sources expose full text as tooltips/titles; existing file/path data titles remain intact.
- Commit, Create Board, and Create Board Variables Storage dialog text wraps within the 520px body, or any demonstrated overflow is corrected narrowly.
- `vanilla-view/no-hardcoded-ui-strings` is an error, the two board webview files are excluded with the phase-3 rationale, and `npm run lint` succeeds with zero errors.
- Localization standards document phase-2 conventions as a concise reference.
- The task results include every English catalog area count and the total.
- `npm run typecheck` and `npm run build-prod` results are recorded; no tests or harnesses are added or run.
- `doc/epics/EPIC-125.md` and `doc/active-work.md` are unchanged; no commit is created.

## Results

- `src/renderer/editors/settings/SettingsView.ts`: widened the navigation tree pane from 220px to 280px, supplied each visible tree label through `getTooltip`, and titled the View Settings File button with its full text.
- `src/renderer/editors/settings/sections/settings-native.ts`: `settingsLink()` now puts the full displayed link text in `title`; existing callers that show paths continue to set the path title themselves.
- `src/renderer/ui/sidebar/MenuBarView.ts`: built-in folder rows use their complete displayed label as their tooltip; custom folder paths retain their existing path tooltip.
- `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`: added full-text titles to ellipsized app labels.
- `src/renderer/ui/sidebar/PinnedRailView.ts`: added titles to clipped editor labels and cleared them for board rows, whose visible names are path data.
- `eslint.config.mjs`: the rule is now `error`; the two board webview files are excluded with a phase-3 / D10 comment.
- The 520px dialog bodies (`CommitDialogView`, `CreateBoardDialogView`, and `CreateBoardVarsStorageDialogView`) do not apply nowrap to body text; no dialog change was needed. Only dialog header titles are ellipsized.
- Verification: `npm run lint` passed with **0 errors** and one existing `maxSearchResults` unused-variable warning in `src/renderer/components/file-search/FileSearchView.ts`; `npm run typecheck` passed; `npm run build-prod` passed. The build emitted existing chunk-size and ineffective-dynamic-import warnings. No tests or harnesses were run. The reported layout defects had been checked live before this task; a post-change live app inspection remains pending.
- `doc/epics/EPIC-125.md` and `doc/active-work.md` were not changed. No commit was created.

Catalog entries by area (`src/shared/i18n/en/*.ts`, excluding `index.ts`):

| Area | Entries |
|---|---:|
| about | 20 |
| api | 69 |
| board | 154 |
| browser | 125 |
| common | 9 |
| dialogs | 114 |
| editors | 107 |
| explorer | 50 |
| git | 58 |
| links | 64 |
| logView | 16 |
| main | 6 |
| menus | 148 |
| mneme | 102 |
| notebook | 24 |
| settings | 205 |
| shell | 117 |
| tools | 112 |
| uikit | 12 |
| **Total** | **1512** |

## Files Changed Summary

| File | Change |
|---|---|
| `doc/tasks/US-1665-closing-sweep/README.md` | Task plan, acceptance criteria, implementation results, verification outcomes, and catalog counts. |
| `doc/standards/localization.md` | Phase-2 localization reference for the next agent. |
| `eslint.config.mjs` | Promote the UI-string rule and exempt phase-3 board webview files. |
| `src/renderer/editors/settings/SettingsView.ts` | Widen Settings navigation and add full-label / footer button tooltips. |
| `src/renderer/editors/settings/sections/settings-native.ts` | Give clipped settings links their full visible value as a title. |
| `src/renderer/ui/sidebar/MenuBarView.ts` | Fall back to the full folder label for its tooltip. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` | Add titles to ellipsized app-text labels. |
| `src/renderer/ui/sidebar/PinnedRailView.ts` | Add titles to clipped editor labels, preserving board path data. |

Files inspected and not expected to change: `doc/epics/EPIC-125.md`, `doc/active-work.md`, `src/renderer/ui/tabs/PageTabView.ts` (existing full-title tooltip), `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` and `SettingsSections.ts` (path titles), `src/renderer/ui/dialogs/CommitDialogView.ts`, `CreateBoardDialogView.ts`, `CreateBoardVarsStorageDialogView.ts` (wrapping body flow), and `src/renderer/uikit/Dialog/Dialog.css` (only dialog header title is nowrap/ellipsized).
