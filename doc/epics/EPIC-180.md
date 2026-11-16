# EPIC-180: Scripted UI integration tests

## Status

**Status:** Completed 2026-11-16
**Created:** 2026-11-16

## Overview

After large refactors, or after a run of features that never touched other parts of the UI,
regressions show up in places nobody re-checked. Checking the whole UI by hand before each release
takes too long. Having an agent do it uses up the Claude/Codex limits. This epic adds a scripted UI
suite that runs **without an LLM**. A Node runner starts Persephone in a throwaway profile kept
inside the repo, seeds it with prepared files, and drives it through the same `call` tree
(ai-vision) that agents use. It asserts the results and writes a report. When the user asks, an
agent runs the suite, which takes one command, and spends tokens only on the failures.

The suite lives in the repo (`integration-test/`), so anyone can run it, and it moves to a new laptop
along with the clone.

## Goals

- `persephone --profile-dir <path>` uses any folder as the profile's data root, so the test profile
  can live at `integration-test/.profile/` instead of `%APPDATA%`.
- Running one command (`npm run test:ui`, with optional area/test filters) resets the test
  profile from a committed seed, starts the app, runs the tests, shuts the app down and writes a
  pass/fail report. A failure report carries the failing step, the last `call` response and a
  screenshot.
- Tests are short, readable `call`-path scripts with a `waitFor` helper. They never use fixed
  sleeps.
- When a test can't reach part of the UI through the `call` tree, that counts as a finding.
  The fix goes into the tree (a `data-name` entry or a node), not into a workaround in the test.
- A pilot of about 10 tests over 2–3 areas shows the approach is reliable before the full catalogue
  is written.
- A documented agent workflow covers two cases. "Run the UI tests" means the agent runs the
  command and investigates only the failures. "Add a test for X" means writing a new test file.

## Non-goals

- No unit tests and no test framework (vitest/jest). Plain Node `.mjs` scripts with a small
  in-repo helper library are enough. See the user's standing preference: this is a release smoke
  suite they asked for, not unit coverage.
- No pixel or screenshot-baseline comparison in this epic. That may come as a later, optional epic
  once the functional suite is stable.
- No CI run. Codex can't launch Persephone (EPERM), and GitHub runners have no desktop session
  worth targeting yet. The suite is run locally by the user or by Claude.

## Design

### Layout

```
integration-test/
  README.md               how to run, how to add a test, how to read a report
  run.mjs                 CLI entry: filters (--area, --test), --app <exe>, --keep-open, --report
  lib/                    runner internals: launcher, MCP client, call(), waitFor(), assert, report
  seed/                   COMMITTED profile seed: settings.json (MCP enabled, fixed test ports,
                          update checks off, first-run prompts suppressed) and any other profile files
  fixtures/               COMMITTED sample data: text/JSON/CSV/markdown files, boards, archives
  tests/<area>/*.test.mjs one file per scenario group (editors/text, editors/grid, dialogs, …)
  .profile/               GITIGNORED — recreated from seed/ at every run
  reports/                GITIGNORED — latest run's report + failure screenshots
```

### Runner flow

1. Delete `.profile/` and copy `seed/` into it. A work copy of `fixtures/` goes into `.profile/`,
   so tests may edit files freely and the committed fixtures stay unchanged.
2. Start Persephone with `--profile uitest --profile-dir integration-test/.profile`. There are three
   targets:
   - **dev** (the primary target, built first). The user's `npm start` is running, and the runner starts
     its *own* second Electron on the dev bundle in `.vite/build/main.js`. That bundle has
     `MAIN_WINDOW_VITE_DEV_SERVER_URL` built in (`scripts/dev.mjs:67`), so the test instance loads
     the current source from the live Vite server, with no build. The user's dev instance keeps
     running untouched. The runner checks that the dev server answers before launching.
   - **prod** (`--prod`, optional). `npm run build-prod` runs, then electron starts on the
     production bundle. It's useful as a post-check on a draft release before publishing, but it is
     not a required release step. The user decides each time whether to run it.
   - **exe** (`--app <exe>`). An installed copy.
   The runner works out which kind of bundle `.vite/build` holds (dev bundles carry the dev server
   URL) and refuses with a clear message when it doesn't match the chosen target. For example,
   `--dev` while the bundle is a production bundle, or a dev bundle whose server is down, which
   would only show a blank window.
3. Wait for the test MCP port. Connect with `@modelcontextprotocol/sdk`'s HTTP client, which is
   already a dependency.
4. Run the selected test files in order. Restart the app between areas, after a crash, and
   whenever a test asks for a clean app.
5. Write `reports/latest.md` plus `latest.json`, print a one-line summary and set a non-zero exit
   code when any test failed.

### Test shape (illustrative)

```js
export default test("grid: sort by column", async ({ call, waitFor, fixture }) => {
    const id = await call("pages.openFile", [fixture("data/people.csv")]);
    await waitFor(`pages["${id}"].editor.id`, (v) => v === "grid-csv");
    await call(`pages["${id}"].editor.sortBy`, ["age"]);
    expect(await call(`pages["${id}"].editor.rows[0].age`)).toBe("19");
});
```

The real API names come from the `call` tree. The pilot task fixes the helper signatures.

### Owners

- `--profile-dir` parsing and data-root selection stays in `src/main/application-profile.ts` and
  `src/main.ts`. The profile *identity* (the name used for the pipe, tray, AppUserModelId, title,
  default ports and board relaunch args) keeps coming from `applicationProfileName()`, so callers
  don't change. Board relaunch (`boardProfileArgument`) must pass the directory along too.
- The runner is a new stand-alone tree under `integration-test/`. It imports nothing from `src/`
  and talks to the app only over MCP. No app code learns about tests.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2022 | `--profile-dir <path>`: use any folder as the profile data root | Done |
| US-2023 | Integration-test runner foundation, dev target (layout, seed/reset, launcher, MCP client, waitFor, report, `--keep-open`, `--rerun-failed`) | Done |
| US-2024 | Pilot tests: text editor, grid editor, one dialog (~10 tests) + close the `call` gaps they find | Done |
| US-2025 | Agent workflow and docs: run/triage/fix-in-place/add-a-test guide, `doc/standards/integration-tests.md` | Done |
| US-2026 | Optional `--prod` and `--app <exe>` targets (draft-release post-check) | Done |

Further areas (pages/tabs, menus, panels, boards, browser with a local fixture server, REST client,
settings, restore after restart) become their own tasks once the pilot is accepted.

## Concerns / open questions

- **Identity for a `--profile-dir` launch (decided 2026-11-16).** `--profile-dir` requires
  `--profile <name>`, and a directory given on its own is a parse error. The earlier idea was to
  derive a name from the folder name plus a hash of the path. It was dropped because the Electron
  app and the Rust launcher would both have to compute exactly the same name, and no user needs it.
  The runner always passes `--profile uitest`.
- **Port clashes.** The seed sets explicit test ports (MCP, video stream, Mneme, Tor), so the suite
  can run while the user's own instance and named profiles are open.
- **First-run and trust prompts** (welcome page, board trust dialog, permission prompts) must be
  suppressed by the seed or handled by a helper. Otherwise every run blocks.
- **Timing.** Lazy editor loading and animations are the main source of flakiness. `waitFor` with a
  per-step timeout is mandatory, and a flaky test is treated as a bug in either the test or the
  app.
- **Dev target caveats.** Vite hot-reloads (HMR) the test window too, so editing source during
  a run can disturb it. A main-process edit makes `dev.mjs` restart only its own Electron, and the
  test instance keeps the old main code until the next run. The dev build also has slower startup
  and dev-only code paths, so the timeouts need to allow for that. Run `--prod` before a release.
- **Prod target freshness.** The prod target rebuilds every time, or warns when `src/` is newer
  than the build. `build-prod` wipes the dev bundle, so a dev Persephone running at the same time
  needs `npm start` again. The runner should say so after a `--prod` run.
- **Coverage limits.** Monaco internals and drag-and-drop may not be reachable by path. The pilot
  will show how far `call` plus `script.execute` gets.

## Notes

### 2026-11-16
- Created from the user's proposal: scripted tests through the ai-vision/`call` tree instead of
  agent-driven sweeps, to save tokens. The user asked for the profile folder to live inside the
  repo (`integration-test/`) and to be portable to another machine.
- The user asked whether tests can run on the dev build. They can: the dev bundle points at the
  live Vite server, so the runner can start a second Electron against it.
- Dev mode is the main workflow and is built first. The agent runs the suite against the live dev
  app, reproduces each failure in the still-running test instance through MCP, fixes the source
  and re-runs only the failed tests. HMR picks up renderer fixes, and a main-process fix needs a
  test-instance restart, which the runner handles. To support this, the runner has `--keep-open`
  (leave the test instance running after failures) and `--rerun-failed`. `--prod` is an optional
  post-check on a draft release, not a rule. The release skill must not make it mandatory.
- Tests drive the app from an outside Node runner, not from in-app scripts. A crashed or hung
  renderer would take an in-app runner down with it, and restart/restore scenarios need a process
  that outlives the app.
