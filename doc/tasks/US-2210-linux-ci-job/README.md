# US-2210: Linux CI job

## Goal

Add an independent, non-publishing GitHub Actions workflow that checks the Linux build and runs the default UI integration suite headlessly. This is the last task in [EPIC-213](../../epics/EPIC-213.md), after US-2204 through US-2209 make the suite pass locally.

## Background

- `.github/workflows/publish.yml` is the only existing workflow. It is Windows release CI, triggered by version tags or manual dispatch, uses Node 20, and publishes with secrets and write permissions. It has no paths filters. The new docs-only filter is an intentional addition, not an existing workflow convention.
- On 2026-11-26 GitHub's [runner image table](https://github.com/actions/runner-images) lists x64 `ubuntu-latest` as Ubuntu 26.04 and also offers `ubuntu-26.04`. The [migration announcement](https://github.com/actions/runner-images/issues/14748) scheduled completion for November 19; the actual job's setup log identifies its image. Use `ubuntu-latest` as the epic requires, log `/etc/os-release` and `uname -m`, and check the first run actually uses 26.04 x64. A container is unnecessary at present. If the label later differs, reassess epic decision 1 rather than silently claiming 26.04 coverage.
- There is no repository Node version file or `engines` pin in `package.json`; `doc/linux-development.md` specifies Node 24, with 24.22.3 validated, and `doc/standards/integration-tests.md` requires Node 24 to execute erasable TypeScript sources. Pin `actions/setup-node` to `24.22.3`, not the release workflow's Node 20. `package-lock.json` pins dependencies, including Castlabs Electron; `package.json` has `postinstall: patch-package`, and the Linux guide explicitly says `npm ci` does not fetch that distribution. Run `node node_modules/electron/install.js` after `npm ci`.
- `integration-test/lib/launcher.mjs` `verifyDevTarget()` requires a live `npm start` marker, live PID, responsive loopback Vite server and matching dev bundle. Instead, `--prod` calls `assertProductionBuildAllowed()` and `buildProduction()`: on a fresh checkout with no live dev marker it runs `scripts/build-prod.mjs` once, then launches the installed Electron against `.vite/build/main.js`. This is a production **bundle**, not a Linux package or release. `--app` needs an already available packaged executable, which the repository does not build for Linux. Do not start `npm start` or separately build twice.
- `integration-test/run.mjs` owns selection, profile resets, local HTTP/HTTPS fixtures and exit status. Without `--with`, opt-in network, Tor, Git, Mneme, microphone and other tags remain skipped; automatic `windows` and `desktop` requirements retain their normal checks. `integration-test/lib/aggregate-report.mjs` writes `reports/latest.json` with `summary` and per-result `status`, `file`, `name`, and optional `skipReason`; `latest.md` and per-run logs/screenshots are also under `integration-test/reports/`. Early discovery or setup failures can occur before an aggregate report exists.

## Implementation Plan

1. [x] Create `.github/workflows/linux-ci.yml`. Before: only the Windows release workflow exists. After: a distinct Linux workflow, with these triggers and permissions:

   ```yaml
   name: Linux CI
   on:
     push:
       branches: [main, 'upcoming-*']
       paths-ignore: ['doc/**', '*.md']
     pull_request:
       paths-ignore: ['doc/**', '*.md']
     workflow_dispatch:
   permissions:
     contents: read
   ```

   The filter ignores a push or PR only when all changed paths match; `*.md` covers root Markdown, while `doc/**` covers the whole developer documentation tree. Manual dispatch is unfiltered. No tag trigger, secrets, release action, or publication.

2. [x] Add one job with `runs-on: ubuntu-latest`, checkout via `actions/checkout@v4`, and `actions/setup-node@v4` with `node-version: '24.22.3'` and `cache: npm`. Log `cat /etc/os-release` and `uname -m`. Use a normal non-root runner; do not disable Electron's sandbox merely to run CI.
3. [x] Install the packages from the validated Ubuntu 26.04 setup plus the headless session tools, then install the locked JS dependencies and Electron:

   ```bash
   sudo apt-get update
   sudo apt-get install -y libnss3 libasound2t64 libgbm1 libxss1 libxtst6 \
     libatk-bridge2.0-0t64 libcups2t64 libdrm2 libsecret-1-0 \
     build-essential curl xz-utils fonts-noto-core fonts-noto-color-emoji \
     xvfb xauth dbus dbus-x11 git
   npm ci
   node node_modules/electron/install.js
   ```

   `doc/linux-development.md` validates the runtime list on 26.04; Ubuntu's [Resolute package index](https://packages.ubuntu.com/resolute/amd64/libs/) and [ALSA package page](https://packages.ubuntu.com/resolute/libasound2t64) confirm the t64 naming, including [AT-SPI](https://packages.ubuntu.com/resolute/libatk-bridge2.0-0t64) and [GBM](https://packages.ubuntu.com/resolute/libgbm1). Install explicitly even where the hosted image already supplies packages. Noto core matches the Linux guide; color emoji supports the epic's glyph checks. Xvfb needs `xauth` for `xvfb-run`; `dbus-run-session` provides a private session bus, rather than relying on a desktop session.
4. [x] Prepare the fresh runner environment before the suite: retain the hosted runner's writable `HOME`, check `test -w "$HOME"`, set an isolated global Git identity with `git config --global user.name 'Persephone CI'` and `git config --global user.email 'ci@example.invalid'`. Some tests create Git commits; `integration-test/tests/editors/compare/compare.test.mjs` sets its own local identity, but a global fallback covers other fixtures. Set `XDG_RUNTIME_DIR` for subsequent steps using `$RUNNER_TEMP/persephone-runtime`, `mkdir -p`, `chmod 700`, and append `XDG_RUNTIME_DIR=$RUNNER_TEMP/persephone-runtime` to `$GITHUB_ENV`. `integration-test/lib/launcher.mjs` profile probing and `src/main/test-mode/profile.ts` require it for Unix sockets; a session bus alone does not set it. The runner's writable checkout and temp directory provide profile, report, and socket storage. The wrapper provides its own isolated test profiles, fake media and loopback fixture servers; no external credentials or services are required for the default selection.
5. [x] Run `npm run typecheck`, then `npm run lint`, then the suite as a named step with an ID, under a private bus and X display:

   ```bash
   dbus-run-session -- xvfb-run -a npm run test:ui -- --prod
   ```

   Do not add `--with`, `--attach`, or `--keep-open`. Preserve the command's nonzero exit status so failures fail the job. The production build runs inside this command, including the capability-contract check; no separate build is needed. Xvfb supplies a display, not a full desktop; inspect `desktop` skips in the first run rather than assuming they execute.
6. [x] Add a summary step guarded by `if: always()` after the suite. It must read `integration-test/reports/latest.json` only if the suite step ran and the file exists, append passed, failed, skipped and not-run totals to `$GITHUB_STEP_SUMMARY`, and list each skipped test's file, name and reason. For example, use a short inline Node script with `fs.readFileSync` / `JSON.parse`, `summary` and `results.filter(r => r.status === 'skipped')`; write to `process.env.GITHUB_STEP_SUMMARY` with `appendFileSync`. Escape Markdown-sensitive test names/reasons or render them as escaped text. If the report is missing or invalid, append an explicit “report unavailable” and the suite step outcome, never fabricate zero totals; retain the original failure. Gate parsing on `steps.ui.outcome` so a pre-suite failure cannot present a stale report. A fresh checkout avoids old reports, but absence must still be handled.
7. [x] Add `actions/upload-artifact@v4` after the summary with `if: failure()` and `path: integration-test/reports/`, `if-no-files-found: warn`; use a distinct artifact name such as `linux-ui-reports`. This captures logs and screenshots on failure without masking failures that occur before reports exist. No upload on successful runs is required.
8. [ ] Verification belongs to Claude: after implementation and the preceding epic work, Claude pushes the branch and checks the first Linux run with `gh run` (including image version, install/build, summary, skipped reasons and any failure artifact). Claude investigates actual failures and verifies a manual dispatch as appropriate. Do not add unit tests or harnesses for this workflow. This task document itself does not trigger or run CI.

## Concerns

- The first run is the evidence for actual GitHub runner behavior, Electron sandbox availability, package installation, UI stability, and the remaining Linux suite failures. The epic requires the earlier tasks and local suite success first; do not hide untagged failures or enable opt-in tests to make counts look better.
- GitHub may change `ubuntu-latest`; record the observed image in the run and revisit the 26.04 decision if it moves. `paths-ignore` can leave a required check pending for docs-only PRs if branch protection requires it; account for that separately when configuring branch protection.
- A failure before aggregate reporting has no reliable totals; show the missing report explicitly. `if: always()` is for diagnostics, not a substitute for the failing suite exit status.

## Acceptance Criteria

- [ ] A separate workflow triggers for pushes to `main` and `upcoming-*`, PRs and manual dispatch, with the specified docs-only filtering and `contents: read`; no secrets or release workflow changes.
- [ ] On the observed Ubuntu 26.04 x64 `ubuntu-latest` runner, Node 24.22.3, apt dependencies, writable home, Git identity, private D-Bus, Xvfb and a mode-700 `XDG_RUNTIME_DIR` support a clean `npm ci` and explicit Castlabs binary download.
- [ ] Typecheck and lint pass; `npm run test:ui -- --prod` builds once and runs the default suite under Xvfb, with opt-in requirements off and failures reflected in job status.
- [ ] The job summary shows skipped and failed totals, lists skipped tests and reasons, and reports missing or invalid aggregates honestly; failure uploads available `integration-test/reports/` diagnostics.
- [ ] Claude pushes and inspects the first run with `gh run`; no unit tests or harnesses are added and nothing is published.

## Files Changed

| File | Change |
| --- | --- |
| `.github/workflows/linux-ci.yml` | New workflow during implementation. |
| `doc/tasks/US-2210-linux-ci-job/README.md` | This plan. |

No changes: `.github/workflows/publish.yml`, `doc/active-work.md`, `doc/epics/EPIC-213.md`, application code, integration runner, package manifests, user guides, or release assets.
