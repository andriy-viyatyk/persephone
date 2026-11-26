# US-2207: Linux board and module environments

Epic: [EPIC-213: Linux core parity](../../epics/EPIC-213.md). Status: Planned.

## Goal

Give Linux board processes and module services profile-isolated data and usable, isolated test environments. Make direct command-line execution work on Linux while preserving Windows behavior.

## Background

- [WIN-12 and WIN-13](../../reviews/multiplatform-2026-11/inventory.md) identify the Windows assumptions; [R-9](../../reviews/multiplatform-2026-11/runtime-findings.md) records that `app.proc.execute` already uses `/bin/sh` on Linux. Claude observed `node: not found` and exit 127 for board scripts and module-service children in the WSL test sandbox; direct spawn of a whole command line also fails with ENOENT. These are reported runtime observations, not new runs in this planning task.
- `src/main/board-process-environment.ts` derives an ID using `BoardRoot.tryFrom`, `bundledBoardId`, and `boardDataIdFromRoot`. Named profiles and test instances use `app.getPath("userData")/board-data/<id>`; the default profile uses `%LOCALAPPDATA%/Persephone/board-data/<id>` only if `LOCALAPPDATA` is absolute. It removes caller-supplied `PERSEPHONE_BOARD_DATA` before setting its own, and does not create the board directory. `src/main.ts` sets named profiles' `userData` before startup.
- `src/main/command-runner.ts` supplies this environment to board `execute` and `executeNode`; `src/main/module-service/process.ts` supplies it to `utilityProcess.fork`. The consumers are board-owned scripts and module-service code reading `process.env.PERSEPHONE_BOARD_DATA`; the in-tree explicit reader is `integration-test/fixtures/boards/module-service/round-trip-board/scripts/service.mjs`. `assets/guides/boards/bridge.md` and `assets/guides/agents/boards/services.md` describe the contract and legacy fallback. No built-in source consumer was found by searching `src`, `assets`, and `integration-test`.
- `applyBoardProcessSandbox` in `src/main/test-mode/board-process-sandbox.ts` acts only in a test instance, creates profile-local home, bin and agent directories, removes inherited PATH variants and Claude session variables, and forwards the host Node via `node.cmd` found from the original PATH. It constructs a Windows system PATH. It does not construct a clean environment from scratch. `src/main/windows-env.ts` is a Windows-only startup backfill and intentionally does nothing on Linux.
- `ModuleServiceProcess.buildServiceEnvironment` copies an explicit Windows-oriented allowlist plus `LANG`, `LC_ALL`, and `TZ`, then sets service, root and locale variables and calls `boardProcessEnvironment`. Thus ordinary Linux services currently miss `HOME` and XDG variables even outside tests. Board `execute` starts from inherited environment plus overrides; the test sandbox must override inherited Linux home, XDG and PATH values in both paths.
- `startJobTo` calls `spawn(command, msg.args ?? [], { shell: opts?.shell ?? true, ... })`. On Linux `shell: false` treats the whole string as the executable; default shell execution is already correct per R-9. `src/renderer/api/types/app.d.ts` exposes `IProc`; the actual contract in `src/renderer/api/types/proc.d.ts` calls the input a full command line and says `false` runs directly. `assets/guides/scripting/api/app-proc-and-boards.md` says the same; `assets/guides/boards/bridge.md` also exposes `execute` and distinguishes argv-style `executeNode`.
- `integration-test/tests/capabilities/module-service/module-service.test.mjs` checks the service, board `execute`, and `executeNode` environments; `assertSandboxEnvironment` currently returns early off Windows, and later directory assertions are Windows-specific. The fixture `scripts/environment.mjs` and `scripts/service.mjs` do not expose HOME/XDG. The proc direct-spawn test passes `node "<script>"` as one string. Existing Windows assertions must remain intact.

## Implementation Plan

- [x] **Board data owner:** in `src/main/board-process-environment.ts`, keep the existing ID and named/test profile logic. For Linux default profile use `path.join(app.getPath("userData"), "board-data", boardId)`, resolved at call time. Electron's per-app `userData` supplies the default profile root; named and test roots remain separately selected by the existing profile setup. Preserve the exact Windows `LOCALAPPDATA` validation and path, including omission on failure; retain existing behavior on other platforms. Select with `isLinux` from `src/shared/platform.ts`. Do not create the board folder or accept an override from the child environment.

  ```ts
  // Before: default profile always requires LOCALAPPDATA.
  dataRoot = path.join(localAppData, "Persephone", "board-data");
  // After: Linux default uses Electron's profile root; Windows retains the above.
  dataRoot = path.join(app.getPath("userData"), "board-data");
  ```

- [x] **Sandbox owner:** extract the existing Windows implementation unchanged into `src/main/test-mode/board-process-sandbox-windows.ts`; add `src/main/test-mode/board-process-sandbox-linux.ts` beside it. Keep `applyBoardProcessSandbox` in `src/main/test-mode/board-process-sandbox.ts` as the test-instance gate and platform dispatch using `isWindows`/`isLinux` from `src/shared/platform.ts`; retain existing non-Linux behavior rather than silently changing other platforms. Share or pass the existing `app.getPath("userData")` and profile paths without duplicating their selection. No new direct `process.platform` checks.

  Linux collaborator creates `<userData>/test-home`, `test-bin`, and within test-home `.config`, `.local/share`, `.cache`, `.local/state`, `.claude`, `.codex`; set `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` to those absolute paths. Remove inherited `XDG_RUNTIME_DIR` and other inherited `XDG_*` values rather than allowing them to reference the real profile; do not invent a runtime directory. Preserve the existing case-insensitive PATH and Claude session variable cleanup, and set `PATH` exactly to `<test-bin>:/usr/local/bin:/usr/bin:/bin`. This restricts directories, not individual system binaries; it does not claim to be a security boundary. Keep test-specific variables and `PERSEPHONE_BOARD_DATA` intact.

  Find the host `node` using the original inherited PATH before replacing it, ignoring empty/relative entries, checking that the candidate is an executable file. Create `<test-bin>/node` as a symlink to the absolute resolved host executable, so paths containing spaces require no shell quoting and the whole host Node directory is not added to PATH. Make repeated calls safe and refresh a stale link; fail clearly if no usable Node is found, rather than silently leaving an unusable shim. Existing Windows `node.cmd` discovery and behavior stay unchanged. Avoid putting user npm, Claude, Codex, or other host home directories on PATH.

  ```ts
  // Before: Windows directories and node.cmd are applied to every test instance.
  writeNodeShim(testBin);
  environment.PATH = [testBin, ...systemPaths].join(path.delimiter);
  // After: dispatch to the platform collaborator, retaining the Windows implementation.
  applyLinuxBoardProcessSandbox(environment, userData); // Linux only
  ```

- [x] **Service environment owner:** move the allowlist-building rule out of `src/main/module-service/process.ts` into adjacent `src/main/module-service/process-environment.ts`, with per-platform lists in adjacent `process-environment-windows.ts` and `process-environment-linux.ts`. Reuse `boardProcessEnvironment` and `getActiveLocale`; the existing method delegates to this collaborator, reducing the process owner. Copy the Windows keys and semantics exactly. Linux copies only `PATH`, `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, and `TZ` when present, then adds the same service/root/locale variables and applies the shared board environment and test sandbox. This allows ordinary Linux service configuration while sandbox overrides/removes host paths in test mode. Keep the existing non-Linux fallback equivalent to today's list. Do not change `src/main/windows-env.ts`: it is specifically Windows backfill, not the service allowlist or test sandbox owner.

  ```ts
  // Before: the service always copies its Windows-oriented allowlist.
  return boardProcessEnvironment(environment, boardRoot);
  // After: platform allowlist is chosen by the collaborator, then the same helper is used.
  return buildServiceEnvironment(boardRoot);
  ```

- [x] **Direct spawn owner:** add `src/main/command-line-linux.ts` as a focused parser used by `src/main/command-runner.ts` only when `isLinux`, `opts.shell === false`, and `msg.args` is absent. Recommend parsing over requiring a bare executable: the public API accepts a full command line and has no public argv argument, and the existing test exercises a quoted script path. Keep Windows and shell-enabled calls exactly as they are; keep explicit `msg.args` argv-style calls untouched, and leave `startNodeJobTo` untouched. Reuse `spawn`, the existing `try`/`RunnerChannel.error` path, and existing stream/job handling. No transport changes.

  Define a small Windows-compatible simple quoting subset: spaces and tabs outside double quotes separate words; double quotes group text and can represent an empty argument; consecutive backslashes before a double quote follow Windows argv rules (2n backslashes yield n and toggle quoting; 2n+1 yield n and a literal quote); other backslashes remain literal. Single quotes, shell operators, expansions, and globbing have no shell meaning. Reject empty executable and unmatched double quotes through the existing error event; require quoting executable paths containing spaces. Preserve the original command for job identity. This subset does not promise every Windows executable's custom command-line parser semantics.

  ```ts
  // Before
  spawn(command, msg.args ?? [], options);
  // After on Linux direct command lines only
  const [executable, ...args] = parseLinuxDirectCommand(command);
  spawn(executable, args, options);
  ```

  Clarify the Linux direct-spawn quoting subset in the comments for `IExecuteOptions.shell` in `src/renderer/api/types/proc.d.ts` and the mirrored contract comments in `src/ipc/runner-channels.ts`; no message shape or protocol changes. The user guides are Windows-oriented for this epic and do not need a Linux-only wording change now.

- [x] **UI coverage:** extend `integration-test/fixtures/boards/module-service/round-trip-board/scripts/environment.mjs` and `scripts/service.mjs` to return HOME and the selected XDG variables, including `XDG_RUNTIME_DIR`. In `integration-test/tests/capabilities/module-service/module-service.test.mjs`, add Linux assertions to `assertSandboxEnvironment` for exact profile-local paths and exact PATH components, absence of the outer runtime directory and user tool folders, and the same result for service, `execute`, and `executeNode`. Branch only the directory checks after the existing Windows assertions so the Windows assertions and their expected values remain unchanged; verify Linux directories and node link exist. The existing node invocation verifies the link actually runs. Preserve `comparablePath`/`sameRoot` helpers and platform-specific path semantics.

  `integration-test/tests/boards/bridge/service-environment.test.mjs` independently expects the Windows `LOCALAPPDATA` sandbox on every platform. Keep that assertion on Windows and add a Linux assertion against the fixture's reported HOME after extending `integration-test/fixtures/boards/bridge/service-environment-board`'s service to return it. Keep the test's trust/cleanup flow and verify that HOME is `<userData>/test-home`.

  Extend the existing `integration-test/tests/capabilities/proc/proc.test.mjs` direct-spawn area with Linux checks for a quoted executable or argument containing spaces, an empty argument, backslashes/escaped quote, and malformed input producing the existing error event; retain the existing Windows tests. Quote the missing executable path on Linux if necessary so the failure still tests ENOENT rather than tokenization. Do not add unit tests or a test harness.

- [x] `npm run typecheck` and `npm run lint` pass.
- [ ] Claude runs the affected `npm run test:ui -- --area <area>` areas on Windows and WSL: `boards/bridge`, `boards/lifecycle`, `capabilities/module-service`, and `capabilities/proc`. The existing owned test checks the test-profile board path; Claude also checks board process environment values in normal default and named profiles on both platforms, confirming Linux paths under the corresponding `userData` and Windows default at the exact legacy location. No new unit tests or harnesses. Report results separately for each OS. Do not start Persephone as part of planning.

## Concerns

- Linux's default profile uses Electron `userData`, whereas Windows deliberately retains the legacy local-app-data path. There is no Linux migration from a previously omitted default path. Board IDs and named/test profile isolation continue through existing helpers.
- The restricted PATH still exposes executables installed in the three system directories. A missing host Node must be reported, and an absolute symlink permits execution of Node without exposing its adjacent user tools. `XDG_RUNTIME_DIR` is removed in tests to prevent use of an inherited session directory.
- Parsing is deliberately limited and does not invoke a shell; commands relying on shell syntax must retain the default shell. Existing direct-spawn paths with spaces must be quoted on Linux. The test suite must verify error delivery as well as successful arguments.
- Per-platform collaborators own the new rules. No new protocol, `window.persephone` member, import-zone workaround, `await import()`, or expansion of a roadmap §2.3 god file is needed. Import platform facts from `src/shared/platform.ts`; do not expand the ESLint platform-check allowlist. These decisions are resolved for implementation; no open questions remain.

## Acceptance Criteria

- [ ] Linux default, named, and test profiles receive board data paths under their respective Electron `userData` roots, with the same board ID rules; Windows paths and omission behavior are unchanged.
- [ ] Linux module services receive the specified normal environment and all three test process paths receive profile-local HOME/XDG and the restricted PATH; Node runs successfully without adding user tool folders. Windows sandbox behavior and assertions remain unchanged.
- [ ] Linux direct `shell: false` executes the documented quoted command-line subset and reports malformed input through the existing error path; explicit argv and default `/bin/sh` behavior remain intact. Windows behavior is unchanged.
- [ ] Typecheck and lint pass; Claude's four named UI areas pass on Windows and WSL. No unit tests or harnesses are added.

## Files Changed Summary

| File | Planned change |
| --- | --- |
| `src/main/board-process-environment.ts` | Linux default board data root; reuse existing ID and profile helpers. |
| `src/main/test-mode/board-process-sandbox.ts` | Gate and dispatch to platform collaborators. |
| `src/main/test-mode/board-process-sandbox-windows.ts` | Extract unchanged Windows sandbox. |
| `src/main/test-mode/board-process-sandbox-linux.ts` | Profile-local Linux environment and Node link. |
| `src/main/module-service/process.ts` | Delegate environment construction. |
| `src/main/module-service/process-environment.ts`, `process-environment-windows.ts`, `process-environment-linux.ts` | Own service environment composition and platform allowlists. |
| `src/main/command-runner.ts`, `src/main/command-line-linux.ts` | Dispatch Linux direct command parsing and spawn. |
| `src/renderer/api/types/proc.d.ts`, `src/ipc/runner-channels.ts` | Clarify direct-spawn comments only; no protocol change. |
| `integration-test/fixtures/boards/module-service/round-trip-board/scripts/environment.mjs`, `scripts/service.mjs` | Expose Linux environment for existing UI test. |
| `integration-test/tests/capabilities/module-service/module-service.test.mjs`, `integration-test/tests/capabilities/proc/proc.test.mjs` | Linux assertions and direct-spawn coverage. |
| `integration-test/tests/boards/bridge/service-environment.test.mjs`, `integration-test/fixtures/boards/bridge/service-environment-board/scripts/service.mjs` | Preserve Windows local-app-data check and verify Linux home isolation. |

**No changes:** `src/main/windows-env.ts` (Windows backfill), `src/main.ts` and `src/main/application-profile.ts` (profile selection), `src/shared/platform.ts` (existing facts), `src/renderer/api/types/app.d.ts` (only exposes `IProc`), `src/renderer/api/proc.ts`, `src/board-shim.ts` and board bridge transport (existing clients/protocol), and the cited guides (epic defers Linux-only guide wording). `doc/active-work.md` and the epic are outside this planning edit.
