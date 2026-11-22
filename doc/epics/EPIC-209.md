# EPIC-209: Guides and scaffolding for web-app tests

## Status

**Status:** Completed 2026-11-23
**Created:** 2026-11-22

## Overview

Step 7, the last step, of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (section 3 G5, G7
and H3–H5). Steps 1a–6 ([EPIC-202](EPIC-202.md) … [EPIC-208](EPIC-208.md)) built the surface: runner fixes, test
window and session pages, polling assertions and file hooks, locators, the page environment and input fidelity. This
epic lets a page model span several files, gives agents a live machine-readable result stream and a starter suite,
and rewrites the guides so they describe that finished surface.

Proposals covered: **G5, G7, H3, H4, H5**.

## Goals

- **G5** A temporary extension's `scriptPath` accepts a folder or a list of files, loaded in order, so a test model
  does not have to be one large file.
- **H5** `--reporter json-lines` writes one JSON object per run event to stdout, so an agent can follow a long run
  without reading files. `report.json` stays as it is.
- **H4** `persephone-test --init <folder>` writes a starter suite (`tests/smoke.test.mjs`, `lib/`,
  `model/app-model.js`, a run script, an `AGENTS.md` brief) that runs green as written against a local page.
- **H3 + G7** The web-app tests guide has the real matcher list, the session-page pattern, the test-window rule, a
  Playwright → Persephone table and "what goes in a model"; `temporary-site-extensions.md` gets a test-model section
  (purpose, model vs test, navigation rule, paging large results, one worked example). Every API named is checked
  against the current source and spot-checked live.

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2176](../tasks/US-2176-model-in-several-files/README.md) | Page model in several files | G5 | Done |
| [US-2177](../tasks/US-2177-json-lines-reporter/README.md) | `--reporter json-lines` on stdout | H5 | Done |
| [US-2178](../tasks/US-2178-test-suite-init/README.md) | `persephone-test --init <folder>` starter suite | H4 | Done |
| [US-2179](../tasks/US-2179-web-app-test-guides/README.md) | Web-app test guides and test-model section | H3, G7 | Done |

Order: US-2176 and US-2177 first (code the guides and the starter suite describe), then US-2178 (its template uses a
multi-file model and its run script can use the reporter), then US-2179 last so the guides describe everything,
including `--init`. Investigations of independent tasks may run in parallel; implementations run one at a time, each
staged after review. If the budget runs out, the epic stops at a task boundary and the rest becomes the next epic.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices.

1. **Guides describe the source, not the review.** Every member, option and matcher a guide names is checked against
   the current code (and, for examples, called live). A proposal the roadmap made that was built differently is
   documented as built.
2. **One owner per rule.** G5 lives where `scriptPath` is resolved today (`TemporarySiteExtensions.ts` and the call
   surface that forwards it); the runner's `ctx.usePage` model option, if it takes a path, reuses the same resolver.
   H5 is a reporter collaborator in `src/test-host/` fed from the same events that already produce `report.json` and
   the console lines; H4 is a new single-job module under `src/main/test-mode/` (argument parsing stays in
   `arguments.ts`), with the template files as assets, not string literals in a god file.
3. **`--init` does not start a window.** It writes files and exits; it refuses to overwrite existing files (lists
   them and exits non-zero) unless the folder is empty or absent.
4. **The starter suite is generic.** No app-specific names; it tests a local HTML page it ships (or a `data:`/file URL)
   so it runs green offline. Its `AGENTS.md` brief states the house rules a test author needs (model vs test,
   navigation, session pages, test window, polling assertions) and points at the guides instead of copying them.
5. **Additive.** Existing reporters, `report.json` and single-file `scriptPath` keep their meaning. A list or folder
   is loaded in a stated order (list order; a folder's `*.js` files sorted by name).
6. **Bridge version.** If `window.persephone` behaviour changes (a board can pass the new `scriptPath` form), bump
   `BOARD_BRIDGE_VERSION` once for the epic (1.62.0 → 1.63.0) with a history line in
   `assets/guides/agents/boards/bridge-versions.md`.
7. **Guardrails.** No new protocol code; god files only shrink; strict folders stay strict. Implementation briefs
   forbid `build-prod` (it wipes the running dev build), `.gitignore` edits and changes to shipped demo boards. No
   customer names; test data is local mock data.

## Notes

### 2026-11-22
- Epic created from roadmap step 7. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Fixes by Claude during review/verification.** US-2177: stream-only events for descriptors a run never reached
  (the first version added `not-run` results to `report.json` only in json-lines mode). US-2178: `fs.cp` failed with
  EEXIST on the destination folder (now file by file with `COPYFILE_EXCL`); init now switches `userData` to a
  throwaway folder before the first await, as the test controller does (it printed Chromium cache "Access is denied"
  errors from the running profile); the fixture page used `form.elements.item` (a method, so no item was ever added);
  the first model read after navigation now polls; the model root carries the required `aiVision` descriptor; the run
  script passes extra runner options through. US-2176 plan: one concatenated scope instead of per-file evaluations
  (files must share helpers); runner `ctx.usePage({ model })` dropped as out of scope. US-2179: worked example
  reduced to excerpts of the shipped template; an out-of-corpus link and an internal note removed.
- **Live verification (dev app).** Folder `scriptPath` with a helper in `00-base.js` used by `10-app.js`; a runtime
  error in the second listed file reported as `10-boom.js:3`, a syntax error as `10-b.js:2`; empty folder rejected.
  `--reporter json-lines` attached and owned: stdout parses as JSON only (test `console.log`, `ctx.log` and app output
  on stderr), retries/flaky/skipped events correct. `--init`: 7 files created, second run lists 7 conflicts and exits
  1; the generated suite passed attached (3 runs) and owned. Guide spot-checks: hidden aliases `fill`, `dblclick`,
  `textContent`; `getByRole` "Did you mean" hint; `allowNavigation` → `{ navigated: true }`, default `page-navigated`;
  `aiVision` error text; new guide page reachable at `guides.agents["web-app-tests"]["browser-models-and-playwright"]`.
- **Checks.** `npm run lint`, `npm run typecheck` (18 strict folders, 0 errors), `npm run guides:check` (138 pages),
  `npm run i18n:check` (no catalog changes, all packs complete). `npm run test:ui -- --area
  browser/site-extensions,browser/page-models,core` 68 passed, 1 skipped (Tor tag); `browser/site-extensions` also
  24 passed / 1 skipped after US-2176.
- **Follow-ups (not done).** A runner `ctx.usePage({ model })` / `openBrowser` model option with runner-owned
  detach; in dev, `npx electron` prints one blank line on stdout before the JSON stream (not the app; packaged
  `persephone-test.exe` is unaffected) — consumers should skip blank lines.
