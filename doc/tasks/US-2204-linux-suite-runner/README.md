# US-2204: Suite on Linux: runner and baseline

## Goal

Make the integration suite select its Linux app and report genuinely unavailable tests as skipped, then record a Linux baseline for [EPIC-213](../../epics/EPIC-213.md). Claude owns live runs; this document is a plan only.

## Background

The suite wrapper owns discovery, selection, suite requirements and aggregate reports; the product test host owns per-test execution and requirements. Linux development uses a running Vite server, while packaged execution has a separate executable path. Windows behavior must remain unchanged.

### Runner trace (WIN-35)

| Owner and operation | Current behavior on Linux |
| --- | --- |
| `integration-test/run.mjs` `main()` and `integration-test/lib/launcher.mjs` `verifyDevTarget()` | Default dev checks the live marker, PID, loopback server and `.vite/build/main.js`; `runProduct()` invokes the installed `electron` package path with `[DEV_MAIN_PATH, "--test", testFolder, ...]`. `--prod` builds the bundles, then uses the same Electron path. Neither discovers a packaged app. `createLauncher().targetCommand()` similarly uses Electron with `.` for dev/production and the specified app for `--open`. US-2203 records owned WSL `core/smoke` 2/2 using dev mode, not a Linux packaged binary. |
| `integration-test/lib/launcher.mjs` `validateExecutable()` | `--app` requires basename `persephone.exe`, case-insensitive on Windows and exact elsewhere, checks regular/readable file; a normal Linux `persephone` is rejected. No PATH search occurs. Error suggestions repeat the Windows name. `createLauncher` directly spawns the validated app for `--open`. |
| `integration-test/run.mjs` product target | For `--app`, unconditionally checks and spawns sibling `persephone-test.exe`; `launcher/src/test_main.rs` forwards `--test` to sibling `persephone.exe`. Linux has neither a usable Windows launcher nor a Linux sibling produced by this configuration. `--attach` goes through Electron/controller, not this packaged branch. |
| `src/main/test-mode/controller.ts` | Uses `isWindows` to reject `--desktop` off Windows, forks the utility host, passes `process.execPath`, `app.isPackaged` and, only for dev, the main bundle. There is no hardcoded `.exe` here. |
| `src/test-host/launcher.ts` | `TestLauncher.arguments()` runs the dev main bundle only when unpackaged and otherwise runs the configured executable directly; it passes the profile and test-instance flags. `appEnvironment()` removes `CHROME_DESKTOP` on Linux for first and second app launches, preserving the Windows environment; this was the US-2203 fix. `killProcessTree()` uses `taskkill /T /F` only on Windows, `SIGKILL` for the POSIX child; Windows-specific `windowsHide` options do not select an executable. `verifyAttachedProfile()` lowercases both paths even on Linux: track as path semantics (US-2205), not a reason to skip tests. |
| `integration-test/run.mjs` `readCurrentVirtualDesktop()`; `src/main/test-mode/desktop-placement.ts` | The wrapper rejects non-Windows before `reg.exe query HKCU` and compares registry IDs around the selected desktop test. Controller rejects `--desktop` on Linux. Placement resolves a requested selector, and installs its Win32 visibility probe only on Windows; its existing direct check is in the shrinking ESLint baseline. Linux has no placement support. No Linux registry or `cmd` invocation is needed for ordinary runs. |
| `integration-test/lib/launcher.mjs` `prepareProfile()`; `src/main/test-mode/profile.ts` | Before deleting the seed profile the wrapper probes `\\\\.\\pipe\\persephone-<user>-uitest` only on Windows; Linux currently goes straight to reset. The controller later uses `getPipePath()` to probe the Unix socket and requires `XDG_RUNTIME_DIR`, but that is after reset. Add the Linux probe before reset in this task. |

`electron-builder.yml` packages Windows `.exe` sidecars and excludes non-Windows Koffi binaries; it does not establish a Linux package. `package.json` `dist` is Windows-only. Packaged Linux discovery can be designed and statically verified here, but an actual package/live launch is a later packaging concern; do not claim it has passed. Do not enable the disabled release `runAsNode` fuse.

### Existing requirement and report path (WIN-36)

`integration-test/lib/context.mjs` declares and validates the finite suite `REQUIREMENT_TAGS`; descriptors use `test(name, run, { requires: [...] })`. `run.mjs` `classify()` excludes `desktop` from opt-ins because it cannot know live visibility; it handles `launch`/attach and other opt-ins before invoking a module. It counts skips in `--list`, constructs `status: "skipped"` with `skipReason`, and `lib/aggregate-report.mjs` collects results. The manifest includes the whole module selection, including wrapper-skipped descriptors, so product enforcement must agree.

The generic `src/test-host/test-api.ts` accepts unique string requirements. `file-hooks.ts` `runnableReason()` exempts `desktop` from `--with` and identifies static skips both before `beforeAll` and per test. `test-file-run.ts` uses `desktopRequirementReason()` after window selection: `src/test-host/desktop-requirement.ts` reads `main.session.locked` and `windows[index].desktopVisible`, returning an explanatory reason. Its `skipped()` writes the normal result and log event; `results.ts`, `runner.ts`, and `json-lines-reporter.ts` report skips and their reasons. `desktop` is a visibility check, not a synonym for Windows.

### Test audit and dispositions

Paths in the table are under `integration-test/tests/`. Preserve existing requirements alongside additions. `windows` is automatic and cannot be overridden by `--with`. Each row identifies descriptors, not an entire area unless stated.

| Test or descriptor | Decision and reason |
| --- | --- |
| `core/virtual-desktop/placement.test.mjs` `owned windows stay on the selected virtual desktop` | Add `windows` beside `launch` and `virtual-desktop`: real Windows registry/placement. |
| `capabilities/terminal/terminal.test.mjs` both `Open terminal here...` tests | Add `windows` beside `launch`: `terminal.launch` is unavailable on Linux; the first copies and runs `open-here.cmd`, the second exercises the same unavailable menu action. |
| `tools/mneme/mneme.test.mjs` both `Mneme Config...` and `Mneme Root...` | Add `windows` beside existing `mneme` opt-in: `memory.mnemeSidecar` unavailable. The Root test also constructs a backslash fixture path; replace with `path.join` when enabling the feature. |
| `tools/clipboard/clipboard.test.mjs` four tests from `Clipboard captures renderer text...` through `Clear empties history...` | Add `windows` alongside `desktop`: each depends on `clipboard.backgroundWatch`. Keep `Clipboard panel shows its disabled warning and opens Settings` untagged; it tests unavailable/disabled UI, not capture. |
| `sidebar/explorer/explorer.test.mjs` `Explorer copies and moves fixture entries with the OS file clipboard`; `editors/folder/folder-view.test.mjs` `Folder View copies and moves local fixture items with the OS file clipboard` | Add `windows` beside `desktop`: `clipboard.files` is unavailable. Other folder/Explorer tests remain portable. |
| `capabilities/audio/audio.test.mjs` `computer capture delivers the fake loopback fixture`; `microphone capture with computer-audio cancellation delivers chunks` | Add `windows` beside `launch`, for unavailable `audio.computerCapture` and `audio.computerCancellation`. Leave invalid-option, microphone and playback tests runnable. |
| `capabilities/proc/proc.test.mjs` `stdin, cwd, env, and direct spawn options work` | Make fixture portable: replace `cmd.exe` and `echo ...\r\nexit` with direct Node stdin echo using a fixture script, retain `shell: false`, stdin/end and cwd/env assertions. Preserve Windows coverage. Leave `spawn failures are reported as errors` unchanged: its nonexistent `.exe` is only a filename. Remaining Node-based process tests stay runnable. |
| `capabilities/module-service/module-service.test.mjs` `service and board child processes receive the test profile sandbox` | Subject is portable isolation. Replace `execute("set")` parsing with a Node environment fixture; split OS-specific environment expectations (Windows `SystemRoot`, `PATHEXT`, Windows `PATH`, `APPDATA`) from common profile isolation, using the platform rule and native paths. Keep Windows assertions intact; Linux HOME/XDG and restricted executable PATH expectations belong to US-2207 and failures remain baseline failures until fixed. Do not label the whole module Windows. `service receives its test-profile board data path` also remains runnable for US-2207. |
| `browser/tor/tor.test.mjs` `Tor check page reports a Tor exit` | Keep `network`, `tor` opt-ins and make the executable fixture portable: `src/main/tor-service.ts` passes the configured path to the sidecar, so `.exe` wording alone does not make the subject Windows-only. Accept a Linux Tor executable via the existing `PERSEPHONE_TEST_TOR_EXE` environment variable and retain Windows behavior; any product failure belongs to the later Tor work. `Tor page without tor.exe is refused...` and `browser/site-extensions/temporary-site-extensions.test.mjs` check current refusal/UI wording and remain runnable. |
| `shell/menu-bar/menu-bar.test.mjs` `header quick settings change a service switch...`, `seeded header status indicators...` | `header-snip-button` opens quick settings, not a snip operation; `HeaderQuickSettingsPopover.ts` gates snip inside the popover. No change in this task; keep both runnable and let the baseline determine any follow-up. |
| `sidebar/panels/other-panels.test.mjs` `Boards and Clipboard entries...` | Tests panel and unavailable/empty state, not necessarily background capture; leave runnable. |
| `published-boards/pe-viewer/pe-viewer.test.mjs` | `.exe` files are PE input data, not processes; keep runnable. Likewise text/image clipboard, generic settings, simulated input, ordinary windows and native path fixtures remain runnable. There is no suite descriptor invoking `persephone-test.exe` or real snip identified in `integration-test/tests/`; packaged runner coverage is a separate check. |

All other discovered descriptors remain untagged for this task. In particular, Node board execution and path handling are portable behavior even if the current Windows-only sandbox or path normalizers make them fail on Linux; assign evidence to US-2205/US-2207 rather than suppressing it.

## Implementation Plan

- [x] **One automatic requirement owner:** add `src/shared/test-requirements.ts`, a small pure module exporting `automaticRequirementReason(requirements, isWindows)` and `isAutomaticRequirement(tag)`. It owns the `windows` rule and returns a stable `requires Windows` reason when false; `desktop` remains the existing live check, and `launch` remains the existing attach rule. Inject `isWindows` from `src/shared/platform.ts`; do not duplicate the OS decision. The product host imports this collaborator normally as `.js`; the `.mjs` wrapper statically imports the source `.ts` directly under the documented Node 24 runtime, which strips its erasable types. Both `src/shared/test-requirements.ts` and `src/shared/platform.ts` must stay import-free, or use only explicit `.ts`-compatible specifiers that Node can load; put the one-line comment `// Loaded directly by Node 24; keep runtime imports compatible with type stripping.` at the top of each. `integration-test/run.mjs` statically imports `../src/shared/platform.ts` for `isWindows`. No asynchronous import, import-zone exception, or new platform check. ESLint's platform rule applies to `src/**/*.ts(x)`; it does not cover `.mjs`, so its existing checks in `run.mjs` and `lib/launcher.mjs` are not allowlist entries. Replace those checks with the shared `isWindows` import where touched; do not expand the `src` baseline.
- [x] **Declare and enforce:** add `windows` to `integration-test/lib/context.mjs` `REQUIREMENT_TAGS`. In `run.mjs` `classify()`, call the shared automatic helper before opt-in filtering, exclude automatic tags from missing opt-ins, and reject `--with windows` (as for `launch`). Extend `renderTestList()` to show each automatically skipped descriptor and its reason on the current platform, while retaining area totals. In `src/test-host/file-hooks.ts` `runnableReason()`, call the same helper before calculating missing opt-ins, including during the pre-hook runnable filter; also reject the reserved automatic tag in product `--with` argument parsing (`src/main/test-mode/arguments.ts`). Keep descriptor validation generic. Existing skip/report paths carry the reason; do not add messages or protocol fields. Preserve other `--with` behavior and `desktop` semantics.

  ```js
  // Before: a new tag would be treated as an opt-in.
  const missing = descriptor.requires.filter((tag) => tag !== "launch" && tag !== "desktop" && !options.with.includes(tag));
  // After: the shared automatic rule decides; opt-ins are checked separately.
  const reason = automaticRequirementReason(descriptor.requires, isWindows);
  const missing = descriptor.requires.filter((tag) => tag !== "launch" && tag !== "desktop" && !isAutomaticRequirement(tag) && !options.with.includes(tag));
  ```

- [x] **Binary choice:** `integration-test/lib/launcher.mjs` owns executable name validation and target command construction; use `isWindows`/`isLinux` from `src/shared/platform.ts`. Windows continues accepting case-insensitive `persephone.exe` and using its sibling `persephone-test.exe`. Linux accepts the exact basename `persephone`, checks regular file and executable access, and runs that app directly with `--test` and the same product arguments; Linux has no console sidecar dependency. Reject unsupported platforms explicitly. Extract a target-command helper into this launcher and have `run.mjs` call it rather than add discovery branches to the wrapper. Retain `--open` direct launch, dev/production Electron targets, options, exit/report handling and Windows validation. No directory scan or guessed release location: `--app` is explicit.

- [x] **Profile reset safety:** extract the Unix socket filename rule from `src/main/pipe-server.ts` into import-free `src/shared/profile-socket.ts`, exporting a pure `profileSocketName(profile)` returning `persephone.sock` or `persephone-<profile>.sock`. `getPipePath()` continues to obtain `XDG_RUNTIME_DIR` and uses `path.join(runtimeDirectory, profileSocketName(profile))`; its Windows pipe branch is unchanged. In `integration-test/lib/launcher.mjs`, statically import the helper's `.ts` source under Node 24, and in `prepareProfile()` on Linux require a nonempty `XDG_RUNTIME_DIR`, join it with `profileSocketName("uitest")`, and call the existing `probePipe()` before `rm`. Preserve its timeout, occupied-profile refusal, `ENOENT`/`ECONNREFUSED` handling and fail-closed handling of other errors; report the missing environment variable clearly. This shares the name rule without importing Electron or duplicating it. Keep the helper import-free for direct Node loading and preserve Windows behavior.

  ```ts
  // Before: getPipePath owns the socket filename inline.
  return path.join(runtimeDirectory, `persephone${profile ? `-${profile}` : ""}.sock`);
  // After: main and the suite use the same pure filename rule.
  return path.join(runtimeDirectory, profileSocketName(profile));
  ```

  ```js
  // Before: --app always chooses a Windows console sibling.
  const testRunner = path.join(path.dirname(options.app), "persephone-test.exe");
  // After: launcher helper selects the existing Windows sidecar or Linux app --test.
  const { executable, args } = await packagedTestCommand(options.app, testFolder, productArgs);
  ```

- [x] Apply the table descriptor by descriptor. For portable process fixtures, use Node and preserve what the test asserts; for sandbox expectations use existing `node:path` and `sameRoot`/fixture helpers, and retain Windows coverage. No Linux workaround in production services belongs here. For the `windows` annotations add to existing requirement arrays rather than replacing opt-ins.
- [x] Update `doc/standards/integration-tests.md` for automatic versus opt-in requirements, Node 24 source loading, Linux `--app` target and the unverified packaging limitation. Keep the validated Linux setup in `doc/linux-development.md` consistent if commands change. Do not edit `doc/active-work.md` or `doc/epics/EPIC-213.md` in this task; Claude owns them.
- [x] Implementer verification only: run `npm run typecheck`, `npm run lint`, and `node integration-test/run.mjs --list` (or the npm equivalent), showing `windows` skips and their reason on the current platform. Do not create unit tests or harnesses. All other verification is Claude's live work.
- [ ] Claude syncs the Linux checkout as in `doc/linux-development.md`, starts `npm start`, then runs the full suite with `npm run test:ui` separately under Xvfb and WSLg. Record commands/environment and area totals, each failure with evidence and owning EPIC-213 task (or new task), and skipped reasons in the table below. Claude also checks affected Windows areas and Windows typecheck/lint. US-2210 owns CI; this task does not publish anything.

**Feature availability recommendation:** use the automatic `windows` requirement for the currently affected feature tests in this task, because all 17 entries in `src/shared/platform-features.ts` are currently Windows-only and the suite's Node-loaded `.mjs` and bundled host do not share a directly loadable feature module today (`platform-features.ts` has an extensionless runtime import). Do not copy that availability table into the runner. When any feature gains another platform, move automatic feature requirements to the same shared requirement owner and have it query `getPlatformFeature()` through a genuinely shared, statically loadable module; replace the corresponding OS tags then. Preserve independent opt-ins. This keeps the existing feature matrix authoritative without introducing a loader wrapper or import-zone bypass for this baseline.

## Fixture portability (follow-up)

Converted hard-coded Windows separators in integration-test fixtures to native `node:path` paths, centralized path comparisons so only Windows normalizes separators and case, selected Monaco shortcuts per platform, and marked the Windows-only board shortcut test accordingly. Windows sandbox PATH assertions remain Windows-only; Linux sandbox expectations stay with US-2207.

## Concerns

- Linux packaged execution is a proposed invocation based on the controller's actual `--test`/`process.execPath` flow, not a verified package: Linux packaging and its native dependencies are out of scope. Missing or non-executable binary must produce an actionable error, not a fallback to Electron or a fabricated pass.
- Windows `.exe` sidecar, direct app and existing flags must stay byte-for-byte equivalent in intent. Linux's executable check must not impose POSIX permission behavior on Windows. `--prod` builds app bundles, not a distributable.
- Availability is static; live `desktop` visibility remains checked in the host after window selection. A static Windows skip must happen before hooks and even when `--with` is supplied. All-skipped selections still need aggregate results.

## Acceptance Criteria

- [ ] Linux dev target and explicit Linux `--app` choose the intended executable and arguments; invalid app names/access fail clearly. Windows target selection and sidecar behavior remain unchanged; no claim of a live Linux package without evidence.
- [ ] Linux profile reset probes the shared Unix socket path before deletion and fails clearly if `XDG_RUNTIME_DIR` is unset or the profile is occupied; Windows probing remains unchanged.
- [ ] `windows` tests skip automatically on Linux with a reason in list and reports and run on Windows without an opt-in; product and suite agree, and `desktop`/existing requirements and file hooks retain their behavior.
- [ ] The audited Windows-only subjects are tagged, portable fixtures remain covered, and Linux failures of portable features are recorded, not hidden. Feature gates are accounted for without a duplicate platform-feature matrix.
- [ ] Typecheck, lint and the current-platform `--list` check pass; Claude records affected Windows checks and complete WSLg and Xvfb baseline outcomes with failure owners. No live run has been performed as part of this plan.
## Baseline run (Claude)

WSL Ubuntu 26.04.1 (WSLg), dev target (`npm start` in WSL, then `npm run test:ui`), full suite. Runs on
2026-11-25/26:

| Run | Passed | Failed | Skipped | Notes |
| --- | ---: | ---: | ---: | --- |
| 0. Before US-2204 | 423 | 50 | 96 | First Linux run. Failures listed below. |
| 1. US-2204 runner + `windows` tags | 431 | 32 | 106 | Windows-only subjects now skip. |
| 2. + portable fixtures, US-2205, US-2207, minimize tags | 464 | 0 | 109 | After every EPIC-213 code task (US-2204 to US-2210 in the tree). |

Failures in run 0 and their owners:

| Failure | Owner |
| --- | --- |
| Fixtures building paths with `\` (settings, startup, folder view, menus, tabs, dialogs, agent tools, tools hub, saved site extensions, board permissions, bridge file access) | US-2204 fixture follow-up |
| Monaco default keys differ on Linux (add cursor below `Shift+Alt+Down`, Format Document `Ctrl+Shift+I`) | US-2204 fixture follow-up |
| Board scripts and module-service children: `/bin/sh: node: not found` (exit 127) in the test sandbox; board starter backend timed out | US-2207 |
| `app.proc.execute("node \"x\"", { shell: false })` → ENOENT (whole line taken as the executable) | US-2207 |
| Terminal, clipboard watcher, OS file clipboard, computer audio, board shortcut | Windows-only subjects: `requires: ["windows"]` |
| `desktop-awareness` and `minimized-page-visibility`: `minimize()` has no effect under WSLg (and Xvfb has no window manager), so `desktopVisible` stays true | Tagged `windows` with a comment; re-check on GNOME in the Phase 2 VM |

Skipped in run 2 (109): 16 `requires Windows`; 86 published-board tests because the `persephone-boards` checkout
is not present in WSL; 7 opt-in tags (tor, network, git and others).

Load note: with Codex runs going on the Windows host at the same time, several whole areas failed at "Runner setup
error: MCP error -32001: Request timed out" (the first call to the freshly started test app). The same areas pass
when run alone, and run 2 ran with the machine otherwise idle. Windows and WSL suites cannot run at the same time:
WSL forwards localhost, so the test ports collide.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/shared/test-requirements.ts` | New single owner of automatic requirement classification, injected platform rule. |
| `src/shared/platform.ts` | Document its direct Node 24 loading constraint. |
| `src/shared/profile-socket.ts`, `src/main/pipe-server.ts` | Share the pure Unix socket filename rule with the suite while preserving existing path behavior. |
| `integration-test/lib/context.mjs`, `integration-test/run.mjs`, `integration-test/lib/launcher.mjs` | Declare, classify and report automatic tags; select and validate platform binary; probe the Linux profile socket before reset. |
| `src/test-host/file-hooks.ts`, `src/main/test-mode/arguments.ts` | Apply the shared rule before hooks and prevent treating automatic tags as opt-ins. |
| Test files in the audit table | Add precise requirements and make portable fixtures portable; preserve Windows assertions. |
| `doc/standards/integration-tests.md` | Document targets and requirements; update Linux development doc only if needed. |
| `doc/tasks/US-2204-linux-suite-runner/README.md` | This plan and Claude's eventual baseline. |

No changes planned: `src/ipc/test-host-protocol.ts`, `src/main/test-mode/controller.ts`, `src/test-host/launcher.ts`, `src/main/test-mode/desktop-placement.ts`, `src/shared/platform-features.ts`, `electron-builder.yml`, `launcher/src/test_main.rs`, `doc/active-work.md`, or `doc/epics/EPIC-213.md`. Existing helpers, host lifecycle, packaging and protocol remain in place. No roadmap §2.3 god file grows; move target logic into the launcher collaborator and requirement logic into the shared owner.
