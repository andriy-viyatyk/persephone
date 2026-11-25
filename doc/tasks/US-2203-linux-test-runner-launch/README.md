# US-2203: UI test runner launches the app on Linux

## Goal

Make the owned development UI runner launch its own app in WSL and produce real `core/smoke` test results. Test failures themselves are Phase 1 work. This task belongs to [EPIC-212](../../epics/EPIC-212.md); Codex owns the plan and implementation, and Claude owns live Linux checks.

## Background

[R-1](../../reviews/multiplatform-2026-11/runtime-findings.md) records Ubuntu 26.04 under WSLg/X11: with `npm start` running, `npm run test:ui -- --area core/smoke` starts the controller and host, then the app exits with `zygote_host_impl_linux.cc:237 Zygote process exited prematurely` (SIGTRAP). With `ELECTRON_DISABLE_SANDBOX=1`, it gets to `GPU process launch failed: error_code=1002` and `GPU process isn't usable. Goodbye.` The same Electron app command from bash starts and exposes MCP. These observations establish a launch-context difference, not its precise kernel or Chromium cause. Do not assume that disabling the sandbox fixes it.

The verified path is:

1. `integration-test/run.mjs` selects modules, resets `.profile`, writes a selection manifest and invokes the dev Electron main bundle as controller with the profile, test setup and log options. `runProduct()` inherits the environment and adds fixture certificate, catalog and audio values. `src/main/test-mode/arguments.ts` parses options; `profile.ts` probes the profile socket and selects its directory/MCP port; `controller.ts` sets throwaway controller data directories, waits for Electron readiness, then forks the host. `init-suite.ts` is a separate `--init` path.
2. `controller.ts` uses `utilityProcess.fork(getNodeHostEntryPath("test-host.mjs", "test-host"), [TEST_HOST_CONFIG_MARKER, JSON.stringify(configuration)], { cwd, stdio: "pipe", serviceName })`; it forwards output and propagates exit/error. `src/test-host/index.ts` finds the marker in argv, parses the existing configuration, runs the host and flushes output. There is no controller/host message exchange to replace: configuration uses argv, results and diagnostics use stdout/stderr and exit status; the host talks to the app over MCP. `src/ipc/test-host-protocol.ts` owns the marker and internal test-instance option recognition.
3. `src/test-host/launcher.ts` builds the app arguments and spawns `configuration.executable` with inherited environment, ignored stdin, piped output, and `detached: keepOpen`. `start()` connects MCP and detects early exit; `stop()` first closes the window and then uses bounded termination; `launchSecondInstance()` also spawns the executable. The dev bundle is `.vite/build/main.js`. `scripts/dev.mjs` and `scripts/build-prod.mjs` build `src/test-host/index.ts` as a Node ESM bundle `.vite/test-host/test-host.mjs` with bundled dependencies; `getNodeHostEntryPath()` resolves this in dev and the asset in packaged builds. `electron-builder.yml` copies the host to `assets/test-host.mjs`.
4. `--open` is different from the failing owned-run path: `run.mjs` calls `integration-test/lib/launcher.mjs` `createLauncher().start()` directly, then retains its PID/MCP record. It does **not** launch through the utility host. `--attach` checks that record and MCP, refreshes fixtures, and starts a controller/host with `--attach`; `TestLauncher.start()` connects to the existing app without spawning it and verifies its profile. Thus R-1's statement that `--open` uses the same broken host path is contradicted by current code; whether `--open` works in WSL is unverified.

### Cause and constraints

The immediate mechanism is that Chromium's zygote and, with sandbox disabled, GPU child fail only in the observed host launch context. The root cause is **unverified**. A utility-process sandbox, inherited Linux namespaces or seccomp restrictions could survive `exec`; inherited file descriptors, `CHROME_*`/`ELECTRON_*` or other environment differences, and session/process-group differences are also hypotheses. The observations do not prove any one of them, nor establish that all utility-process descendants fail. `detached` is false on the ordinary smoke run, while `--open` uses a detached direct child; that is a possible difference, not a proven fix.

The installed Castlabs Electron 44 `node_modules/electron/electron.d.ts` `ForkOptions` defaults `env` to `process.env`, permits `cwd`, `execArgv`, session/partition and stdout/stderr `stdio` options, and lists macOS-only unsigned-library/disclaim options. It exposes **no Linux unsandboxed utility-process option**. The controller supplies no `env`, and the launcher's `spawn` supplies none, so both use their respective inherited environments; the typings do not prove Electron makes no additional runtime environment changes. Standard piped stdio is explicit, but other inherited descriptors and kernel restrictions have not been measured.

Ranked options:

1. **Primary:** Linux development controller starts the same host bundle as a direct Node-mode child using the Electron executable and `ELECTRON_RUN_AS_NODE=1`. It avoids the utility-process boundary while reusing argv, streams, exit handling and MCP. Electron's RunAsNode fuse must permit it: `electron-builder.yml` explicitly disables it for packaged builds; `scripts/dev.mjs` changes only the cookie-encryption fuse and does not establish the RunAsNode setting. Check the dev binary in the live check. This task targets the development command, not a packaged Linux runner.
2. **Conditional fallback:** if the one comparison below identifies a specific inherited environment difference, remove only that confirmed culprit for Linux app spawns. Preserve display/session variables and the runner's fixture variables. Scrubbing guessed `CHROME_*`/`ELECTRON_*` wholesale is not justified.
3. **Utility option:** no suitable Linux sandbox option exists in the installed typings; do not invent one or change global sandbox policy. A process-group change alone is also unproven; apply it only if the comparison points there and preserve cleanup/retention semantics.

## Outcome (Claude, 2026-11-25): read this first

**The plan below was superseded by a live diagnosis.** Codex implemented the planned host as a Node-mode child
process, but `core/smoke` still crashed in WSL. Two things were checked:

- **Where the app was launched from.** In a bare Electron main process, a host spawned as a Node-mode child and a host
  spawned as a `utilityProcess` both fail in the same way, so the host type was never the cause.
- **What the app inherits.** Electron's main process adds `CHROME_DESKTOP`, `FC_FONTATIONS` and `NO_AT_BRIDGE` to its
  own environment. Removing each one separately showed that **`CHROME_DESKTOP` alone** makes the spawned Persephone
  die ("Zygote process exited prematurely", SIGTRAP). With it removed, the app starts from both host types.

**What shipped:**

- `src/main/test-mode/test-host-process.ts` was removed, and `controller.ts` keeps its original `utilityProcess.fork`.
  The only controller change is that the `--desktop` platform check uses `isWindows`.
- `src/test-host/launcher.ts` `appEnvironment()` removes `CHROME_DESKTOP` from the app's environment on Linux. This
  applies to both `start()` and `launchSecondInstance()`, uses `isLinux`, and leaves Windows unchanged.

**Result:**

- **WSL:** `npm run test:ui -- --area core/smoke` launched its own app and passed 2/2.
- **Windows:** `core/smoke` 2/2, `core/startup` 6/6, `boards/lifecycle` 12/12 and `core/scripting` 6/6, run with
  Codex's version. The final change only adds an `isLinux` branch in the launcher, and typecheck and lint pass on it.

The checklist below records the superseded plan.

## Implementation Plan

- [x] **Host creation owner:** add `src/main/test-mode/test-host-process.ts` beside the controller. Use `isWindows` and `isLinux` from `src/shared/platform.ts` to retain the existing utility fork exactly on Windows and other unsupported platforms, selecting a Node-mode child only on Linux when `app.isPackaged` is false. Do not add `process.platform` checks or widen the ESLint allowlist. Reuse `getNodeHostEntryPath()` and `TEST_HOST_CONFIG_MARKER`; pass the same cwd, marker, JSON configuration and piped stdout/stderr. Use `spawn(process.execPath, [entry, marker, json], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })`, without an IPC channel: none is used. Return a narrowly typed common child surface for stdout/stderr and exit/error handling. Ensure spawn errors, signal exits (`code === null`), and output forwarding still produce the controller's current result. Keep `serviceName` and the original fork options on the utility branch.
- [x] **Controller owner:** replace only the host fork in `src/main/test-mode/controller.ts` with the collaborator; keep configuration, profile checks, temporary-directory lifecycle, event handling and exit behavior. Conceptually:

  ```ts
  // Before
  host = utilityProcess.fork(entry, [TEST_HOST_CONFIG_MARKER, json], utilityOptions);
  // After (collaborator retains that exact Windows branch)
  host = startTestHost(entry, json, options.cwd, app.isPackaged);
  ```

- [x] **App environment owner:** in `src/test-host/launcher.ts`, ensure the Linux Node-mode host does not pass `ELECTRON_RUN_AS_NODE=1` to the app: build a copy of `process.env`, delete that one key, and supply it to **both** `TestLauncher.start()` and `launchSecondInstance()` on the Linux Node-host path. Otherwise Electron would start as Node rather than the application. Preserve all other inherited values including `DISPLAY`, `XDG_RUNTIME_DIR` and `PERSEPHONE_TEST_*`; Windows must retain its current spawn options and environment. Use the existing platform helpers, and keep app-argument construction, MCP, reporting, and `--keep-open` behavior intact. No new wire protocol or custom message correlator.
- [x] **First attempt:** ran `npm run typecheck`, `npm run lint`, and `npm run build-prod` successfully. Live checks remain with Claude as listed below. Do not write unit tests or a new harness. If the smoke command reaches actual tests, report their real pass/fail results and leave test-specific fixes to Phase 1.
- [ ] **One diagnostic if launch still fails:** Claude captures one side-by-side snapshot during the same WSL session, comparing the failed host-launched app chain with the working bash launch: command/parent PID and session/process-group IDs, `/proc/<pid>/status` namespace/seccomp and `NoNewPrivs` fields, namespace links, open FD targets, and the **names** plus safely selected non-secret values of relevant `CHROME_*`, `ELECTRON_*`, display/session and `PERSEPHONE_TEST_*` variables. Include stderr/exit signal and whether the dev RunAsNode fuse is enabled. Capture the host before it exits and compare equivalent stages; do not dump secrets. This single comparison distinguishes the principal candidate differences but may still be inconclusive.
- [ ] **Fallback:** if that snapshot isolates an environment variable, change only the Linux launcher environment for both app spawns and repeat the smoke live check. If it instead isolates a process-group difference, use the existing `src/main/command-runner.ts` POSIX precedent (`detached: true` creates a group; negative PID signals that group) only where safe for owned cleanup; never signal the controller's group, and preserve retained apps. If evidence implicates inherited kernel restrictions, a disabled dev RunAsNode fuse, or remains inconclusive, record the precise result and escalate R-1 to Phase 1 rather than adding a speculative sandbox bypass or new protocol. Do not mark the exit criterion met until actual test results exist.

### Other Linux issues in the runner path

| Finding and owner | Effect on `core/smoke` | Disposition |
| --- | --- | --- |
| `src/test-host/launcher.ts` `killProcessTree()` uses `taskkill /T /F` on Windows, but on POSIX only `child.kill("SIGKILL")`; descendants can survive and hold pipes. `stop()` bounds waits and destroys pipes. `src/main/command-runner.ts` shows a separate process-group pattern. | Not a proven startup blocker; may prevent a subsequent module if a process or port remains. | Fix here only if live smoke demonstrates it blocks reporting or the next owned launch; preserve Windows and `--keep-open`. Broader tree cleanup is Phase 1. |
| `integration-test/lib/launcher.mjs` `prepareProfile()` probes the named pipe only on Windows, then resets the profile; product `profile.ts` probes the Unix socket later using `getPipePath()` and requires `XDG_RUNTIME_DIR`. | A free profile and set runtime directory are prerequisites; skipping the pre-reset Linux check is a safety gap if an existing profile owns it, not proven to block a clean smoke run. | Claude verifies a free profile and `XDG_RUNTIME_DIR`; fix a demonstrated clean-run blocker here. Robust pre-reset Unix probing belongs to Phase 1. |
| `integration-test/lib/launcher.mjs` `validateExecutable()` requires `persephone.exe` even on POSIX; `run.mjs` expects sibling `persephone-test.exe` for `--app`. Packaged `runAsNode` is disabled. | Dev smoke uses imported Electron and `.vite/build/main.js`, not these executable names. | Phase 1 packaged Linux target/launcher design; do not enable the release fuse here. |
| `src/main/test-mode/board-process-sandbox.ts` constructs `node.cmd`, searches `node.exe`, and restricts PATH to Windows system paths; Windows-only helpers and fixtures exist elsewhere in the suite. | Neither `core/smoke/connection.test.mjs` nor `file.test.mjs` runs board commands; `file.test.mjs` opens `fixtures/smoke.txt`. Fixture or app-specific test failures are real results, not launch blockers. | Board process isolation and platform-specific fixture/tool coverage belong to Phase 1; preserve isolation rather than widening PATH as a shortcut. |
| `src/test-host/launcher.ts` `verifyAttachedProfile()` lowercases paths unconditionally. | Not used by owned smoke; Linux paths can be case-sensitive. | Phase 1 attach identity fix using existing platform path rules. |
| `--desktop` uses Windows virtual desktop APIs and `init-suite.ts` prints a PowerShell starter command. | Neither is selected by dev smoke. | Phase 1 or later platform support; no changes here. |

## Concerns / Open questions

- **Resolved by a pre-check (Claude, 2026-11-25, WSL):**
  - `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -e ...` runs, so the dev binary's RunAsNode fuse is
    enabled.
  - A script running in that Node mode spawned the app with `ELECTRON_RUN_AS_NODE` removed from its environment:
    `spawn(process.execPath, [".vite/build/main.js", "--profile", ..., "--test-instance", "--test-mcp-port=7991"])`.
  - The app started ("MCP HTTP server started") and exited with code 0 on SIGTERM.
  - So the primary approach works; implement it. The diagnostic and fallback below are kept only in case the real
    host behaves differently.
- The root cause inside the utility process stays unverified. It isn't needed for this task.
- Electron Node mode may differ from the utility host in runtime behavior or packaged asset access; this plan deliberately limits selection to Linux dev and does not claim packaged support. If the dev fuse blocks the primary approach, capture it in the diagnostic and escalate rather than silently changing the release security fuse.
- The epic records an escalation if no path works; this task's success criterion remains actual owned smoke results. An escalation is a recorded blocker, not a successful run.

### Live check (Claude)

- In WSL Ubuntu 26.04 with WSLg/X11, a free `uitest` profile and `XDG_RUNTIME_DIR`, sync changes and start `npm start`; verify the dev Electron binary allows RunAsNode.
- Run `npm run test:ui -- --area core/smoke` without `ELECTRON_DISABLE_SANDBOX`; confirm each selected module starts its own app, connects MCP, executes tests and writes real per-module and aggregate results. Record pass/fail, stderr, exit status and cleanup; passing tests are not required.
- If the first attempt fails, run the single comparison above, apply the evidence-based fallback if applicable, and repeat. Record an inconclusive or blocked result for Phase 1.
- Exercise `npm run test:ui -- --open`, then `npm run test:ui -- --attach --area core/smoke`; confirm attach uses the retained app and does not shut it down. These are separate regression checks, not a substitute for the owned-run exit criterion.

## Acceptance Criteria

- [x] WSL owned `npm run test:ui -- --area core/smoke` (2026-11-25: 2/2 passed) launches its own app and reports actual executed test results, pass or fail; no attach-only or synthetic startup-failure result counts.
- [x] (2026-11-25, final code: core/smoke 2/2, core/startup 6/6; earlier with Codex's version also boards/lifecycle 12/12, core/scripting 6/6) Windows keeps the original utility fork, launcher behavior, protocol, output and lifecycle. On Windows re-run `npm run typecheck`, `npm run lint`, and `npm run test:ui`, including `core/smoke`, `core/startup` (restart and second-instance), `--open`/`--attach`, owned `--keep-open`, and JSON-lines reporter coverage using the existing suite/product runner.
- [x] (Superseded: no Node-mode host.) The Linux app and second-instance spawns do not inherit `CHROME_DESKTOP`, while required fixture/display environment survives; no new protocol, unit tests, harness, platform-check allowlist entries, or release-fuse change.
- [x] Claude records the live command, results and any remaining root-cause evidence. No Phase 1 test-passing work is included.

## Files Changed Summary

| Path | Planned change |
| --- | --- |
| `src/main/test-mode/test-host-process.ts` | Not added: Codex created it, and it was removed after the diagnosis (see Outcome). |
| `src/main/test-mode/controller.ts` | The `--desktop` platform check uses `isWindows`; the host fork is unchanged. |
| `src/test-host/launcher.ts` | `appEnvironment()` removes `CHROME_DESKTOP` on Linux for both app spawns. |
| `doc/tasks/US-2203-linux-test-runner-launch/README.md` | This task plan and later verification evidence. |

No changes planned: `src/ipc/test-host-protocol.ts`, `src/test-host/index.ts`, `src/main/test-mode/arguments.ts`, `src/main/test-mode/profile.ts`, `src/main/test-mode/init-suite.ts`, `src/main/utils.ts`, `src/main/command-runner.ts`, `integration-test/run.mjs`, `integration-test/lib/launcher.mjs`, `scripts/dev.mjs`, `scripts/build-prod.mjs`, `electron-builder.yml`, smoke tests and fixtures. Revisit only if live evidence identifies a necessary smoke launch blocker.

