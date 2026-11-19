# EPIC-200: Published boards — bugs and documentation found by the UI test roadmap

## Status

**Status:** Completed 2026-11-19
**Created:** 2026-11-18

## Overview

The work happens in the `persephone-boards` repo (`C:\projects\persephone-boards`, branch `develop`). This epic is
tracked in the Persephone repo because the problems were found here, while the UI test roadmap covered the published
boards (EPIC-193 to EPIC-198). The evidence is in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md) and in
those epics' open items in [completed.md](completed.md).

Each fix is a board change: bump the board's `version`, then republish through the boards catalog.

## Goals

- Fix the board bugs that make tests fail or that hide errors from the user.
- Make each board's `CLAUDE.md` / README agree with what the board does.
- Give agents result shapes and model coverage in the board guides, so they no longer have to read board source.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-2127](../tasks/US-2127-theme-editor-preview-status/README.md) | Theme Editor: `previewStatus.pending` never settles | Done |
| [US-2128](../tasks/US-2128-audio-player-model/README.md) | Audio Player: playlist `next()`, light-mode model, `previous()` | Done |
| [US-2129](../tasks/US-2129-pptx-parse-errors/README.md) | PowerPoint Viewer: report parse errors instead of an empty deck | Done |
| [US-2130](../tasks/US-2130-board-doc-fixes/README.md) | Board docs that disagree with the board | Done |
| [US-2131](../tasks/US-2131-board-agent-guides/README.md) | Agent guides: result shapes and model coverage | Done |

### Theme Editor: `previewStatus.pending` never settles
`queueDraftRefresh` stores the timeout id in `state.previewTimer` and never clears it after the timer fires
(`theme-editor/app.js:1283-1312`). `pending` includes `!!state.previewTimer` (`app.js:1667`), so it stays `true`
after the first edit.

- **Fix:** set `state.previewTimer = 0` when the timer fires.
- **Test:** this is an EPIC-194 open item; one Persephone test stays failing until the fix ships.
- **Also say what `revert()` does once its source theme was deleted.** It throws "This saved theme was removed".

### Audio Player
- **The playlist `next()` bug.** It is one of the three known failures in the final roadmap run (EPIC-197 open item).
- **Light mode has no model.** A plain audio file opened directly runs in light mode, which never creates
  `editor.app` (`audio-player/app.js:284-317`). Say so in `CLAUDE.md` and the model `$help` summary.
- **Add `previous()` next to `next()`.** The model has `play`, `pause` and `next` only (`ai-vision.js:159-205`), and
  a plan guessed `previous()`.

### PowerPoint Viewer: report parse errors
The vendored pptx-preview swallows its parse errors. A deck it cannot read shows "This deck has no slides." and
`isLoaded` stays `false`, with no console message and no model member saying why. Expose the error, for example as
`getStats().error` plus a console warning, so a broken file is not reported as an empty deck.

### Board docs that disagree with the board
| Board | Wrong | Right |
|---|---|---|
| pdf-viewer `CLAUDE.md` | Wins `.pdf` at priority 200 over a built-in PDF editor at 100 | Manifest `editorPriority: 100`; Persephone has no built-in `.pdf` editor, so the board wins because Monaco's fallback is tier 0 |
| notebook `CLAUDE.md` | `nav.js` is a placeholder | `nav.js` implements the Categories & Tags secondary view |
| aivision-explorer `CLAUDE.md` | Version `1.0.5` / `minAppVersion` `5.0.3`; suggests inspecting `editor.app` | Manifest `1.1.0` / `5.0.10`; the board has no `.app` model |
| wake-word README | The loudness gate as a general fallback | It is used only when the VAD model fails to load; Silero VAD rejects synthetic audio (as `CLAUDE.md` says) |
| agent-log-viewer `CLAUDE.md` | No record formats | Add an "accepted records" note from `scripts/parsers/claude-code.mjs`, `codex.mjs`, `session-model.mjs` |

### Agent guides: result shapes and model coverage
- **One example result per model method** in each board's `guides/agent.md`:
  - SQLite `query()` returns `{ columns, rows: [{ row, cells }], rowCount, totalRows, sql }`;
  - SQLite `getTables()` entries carry `rowCount` (and `unreadable` when a count failed);
  - Force Graph `nodes` is an indexed collection, not the file's array;
  - Theme Editor results: `saveAs`, `rename`, `deleteThemeCore`.
- **Conventions:**
  - say "1-based" next to every slide or page member (the PowerPoint model is 1-based, while its renderer stores a
    0-based index);
  - Chess `lastMove().color` is `"white"` or `"black"`;
  - Gem Keep's starting gold is the level's gold multiplied by the difficulty factor.
- **A table of which boards publish `editor.app`, and in which open modes.** These boards have none: Font, PE and
  Certificate viewers, Speech to Text, Text to Speech, Wake Word. A matching table in Persephone's
  `guides/agents/boards/published-boards.md` is EPIC-199's or this epic's to add, whichever lands second.

## Notes

### 2026-11-18
- `persephone-boards` has been read-only so far. Starting this epic is the user's approval to edit that repo.
- `_test/sample.db` was flagged as possibly holding real names; the user checked it, and it is agent-generated
  synthetic data. No task needed.

### 2026-11-19 — epic started (unattended run)
- Task ids US-2127..US-2131 assigned; epic moved to **Active**.
- **Decision — task documents live in this repo, code in `persephone-boards`.** Codex plans with its working root at
  Persephone (it writes the task document there and reads the boards checkout) and implements with its root at
  `persephone-boards`. Persephone-side test edits are made separately. No `BT-` tasks are opened in the boards repo:
  this epic's task documents are the record, and one boards commit on `develop` references them.
- **Decision — one version bump per board for the whole epic.** Every board whose shipped files change (code, guides,
  `CLAUDE.md` or README all ship in the ZIP) gets one patch bump and one `WHATS-NEW.md` heading; a later task in this
  epic adds its line under the heading an earlier task created instead of bumping again. Nothing is published:
  merging `develop` to `main` stays with the user.
- **Decision — the model-coverage table in `published-boards.md` is this epic's.** EPIC-199 did not add one
  (checked 2026-11-19), so US-2131 adds it.
- **Decision — PowerPoint parse errors are `editor.app.error`, not `getStats().error`.** `getStats()` requires a
  loaded deck, so a failed load could never reach it. `error` is readable while `isLoaded` is false. The vendored
  parser now rethrows a `presentation.xml` failure; a slide failure keeps the slides already read (partial deck,
  `error` set, console warning, toast) and fails the load only when no slide was read (US-2129).
- **Decision — Agent Chat (`claude-agent`) result examples are left out of US-2131.** The epic did not list it and
  EPIC-201 changes that board next; it keeps its row in the model-coverage table. Follow-up for EPIC-201.
- **Decision — Audio Player and Gem Keep get mounted `guides/` folders** (`guides: "guides"` in the manifest, read
  by Persephone 5.0.2+, below both boards' `minAppVersion`). Theme Editor's result examples went into its live
  model `$help`, which is what an agent reads for a board without a guide.
- **Test note (US-2128).** The M3U test now also calls `app.previous()` and the Next button. The transport buttons
  are revealed on hover, so the test hovers `.transport` first, and its WAV fixtures are 30 s long so the first
  track does not end and auto-advance mid-test.
- **Board versions on `develop` (not published):** agent-log-viewer 1.1.1, aivision-explorer 1.1.1, audio-player
  1.0.6, chess 1.2.1, drawio-viewer 1.2.2, excel-viewer 1.3.1, force-graph 1.1.2, gem-keep 1.0.1, notebook 1.0.1,
  pdf-viewer 1.2.1, powerpoint-viewer 1.2.1, sqlite-viewer 1.2.1, theme-editor 1.2.2, todo 1.3.1, wake-word 1.2.1,
  word-viewer 1.2.1. Publishing is the user's merge of `develop` into `main`.
- **No new Persephone catalog text.** New board UI text (PowerPoint error/partial-load toasts, Audio Player model
  summary) was translated into all 18 board packs in the boards repo.

