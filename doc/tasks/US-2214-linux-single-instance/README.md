# US-2214: Single instance, file handoff and profiles

[EPIC-214](../../epics/EPIC-214.md) · Implemented · Claude VM checks and one fix

## Goal

On Linux, a second launch opens its file in the existing instance for the selected application profile, resolves relative paths against the caller's directory, and starts reliably after normal quit or SIGKILL. Measure handoff before considering a Linux launcher.

## Background

- `src/main/application-profile.ts:9` parses and lowercases `--profile` / `--profile=`, validates names, resolves `--profile-dir` against the process cwd, and removes those options from operands; `src/main.ts:19` sets named `userData` and `sessionData` before `requestSingleInstanceLock()` and quits a lock loser (`src/main.ts:31`). The profile directory, not merely the name, determines the lock; use the same directory for both launches.
- `src/main/main-setup.ts:89` forwards Electron's second-instance command line and **its working directory** to `openWindows.handleSecondInstance`. `src/main/open-windows.ts:221` calls `parseLaunchInputs`, brings a normal window forward for no inputs or non-board inputs, and dispatches each input. `bringToFront` calls `makeVisible` and focuses a normal window (`src/main/open-windows.ts:519`, `src/main/open-windows.ts:533`); US-2213 relies on this for hidden-window recovery. File, diff and URL dispatch use existing window messages (`src/main/open-windows.ts:367`, `src/main/open-windows.ts:385`).
- `src/main/launch-inputs.ts:5` parses cold-start argv with the process cwd; `parseLaunchInputs` delegates to `launchOperands` and `parseLaunchArguments` (`src/main/launch-inputs.ts:13`). `src/main/utils.ts:129` strips profile/test options and the Electron app operand in default-app mode. `src/main/utils.ts:141` resolves board, diff and file operands against the supplied cwd, checks paths, and preserves HTTP(S) URLs (`src/main/utils.ts:157`, `src/main/utils.ts:171`, `src/main/utils.ts:176`). Thus the intended Linux route exists in code, but delivery, timing and startup races need VM verification; it may need no code changes.
- The Windows-only Rust launcher uses Win32 foreground permission and a per-user/profile named pipe (`launcher/src/main.rs:17`, `launcher/src/main.rs:35`, `launcher/src/main.rs:42`), resolves paths from the caller's cwd (`launcher/src/main.rs:51`), sends ordered messages or spawns Electron (`launcher/src/main.rs:169`, `launcher/src/main.rs:181`). Linux's Electron route does not require this launcher or its protocol. Packaging and a `persephone` command are Phase 4 work, not a new wrapper here.
- `src/main/pipe-server.ts:11` selects the named pipe on Windows or `$XDG_RUNTIME_DIR` plus the profile socket name on Linux (`src/shared/profile-socket.ts:1`); absent runtime directory logs and skips the server (`src/main/pipe-server.ts:164`). The server is a separate service started at ready and disposed at quit (`src/main/main-services.ts:333`), not the Electron lock's transport. On `EADDRINUSE`, `removeStaleSocket` probes, refuses a live or unsafe socket, compares device/inode and retries (`src/main/pipe-server.ts:77`, `src/main/pipe-server.ts:126`, `src/main/pipe-server.ts:136`, `src/main/pipe-server.ts:151`). Quit calls `server.close()` and its close handler schedules identity-checked asynchronous unlink (`src/main/pipe-server.ts:88`, `src/main/pipe-server.ts:101`, `src/main/pipe-server.ts:119`, `src/main/pipe-server.ts:186`); `will-quit` does not await disposal (`src/main/main-setup.ts:52`, `src/main/main-setup.ts:80`). R-6 records both a leftover during startup termination and successful reclaim after SIGKILL (`doc/reviews/multiplatform-2026-11/runtime-findings.md:49`).
- Decision: **do not add synchronous unlink now**. A leftover alone is not a failure if the next start safely reclaims it; sync unlink cannot run after SIGKILL and must not remove another server's socket. If Claude demonstrates normal-quit cleanup or subsequent reclaim fails, fix the demonstrated lifecycle race in `src/main/pipe-server.ts`, preserving identity checks and Windows behavior, and use synchronous cleanup only if necessary. Electron's own lock files and this service socket must be distinguished in the diagnosis.

## Implementation Plan

- [x] Claude runs checklist items 10–13 in the Ubuntu GNOME Wayland VM and records commands, profile names/directories, observed PIDs, socket paths, outcomes and logs here. Codex does not perform live Linux checks. Use a disposable named profile and files; first ensure US-2213's window recovery is available, or record a visibility failure separately from handoff.
- [x] Start one dev instance with `npm start -- --profile us2214` from the repository. `package.json:9` invokes `scripts/dev.mjs`; it launches Electron with `.` and forwarded arguments (`scripts/dev.mjs:195`), and the dev script clears/rebuilds outputs and starts watchers (`scripts/dev.mjs:294`, `scripts/dev.mjs:318`). Do **not** start a second `npm start` concurrently: it rebuilds shared output and measures the dev tool, not handoff. While the first instance remains ready, from a different directory invoke the same `node_modules/electron/dist/electron` using absolute paths to both the binary and repository app directory, followed by `--profile us2214 'relative file.txt'`. Run with the VM's graphical-session environment and without `ELECTRON_RUN_AS_NODE`. This exercises Electron default-app argv with the caller's actual cwd. For the default profile repeat without `--profile`; for named profile also run default and named instances simultaneously and confirm each receives only its own file. Check `--profile=us2214`, absolute and relative paths containing spaces, and two different cwd directories containing identically named files, confirming actual content/path in the intended existing window and no surviving second main process. Check a plain second launch recovers a hidden window, and check existing diff and HTTP(S) inputs for regressions. Confirm a cold start from a different cwd using absolute app path, and repeat with the same explicit `--profile-dir` on both launches. Record any launcher-argument differences instead of assuming packaged argv matches dev argv.
- [x] Measure a ready, already-running instance using the direct Electron invocation above, not `npm start`. Capture a screen recording with a visible high-resolution stopwatch started at command submission; stop at the first frame where the requested file's content is visible in the existing window. Use ten distinct small local files, one warm-up excluded, for default and named profiles; record all samples, median, maximum, VM load, command, and whether focus/window was already visible. Separately record shell elapsed time to secondary-process exit (e.g. shell `time`), which is **not** the visible handoff latency. If visible handoff exceeds **1,000 ms in at least two of ten measured trials** in either profile, repeat once under idle conditions; if repeated, document evidence and request a separate launcher decision/design under epic decision 5. Otherwise retain Electron. Do not implement a Linux launcher as part of this plan.
- [x] For each profile, cleanly quit the app (not merely hide it), wait for its main PID to exit, inspect its socket, then immediately restart and verify a fresh server is listening and a second launch opens a file. Repeat after `kill -9` of the identified Electron **main** PID; stop the dev watcher first or use a separately started direct Electron process so it cannot restart the victim. Wait for exit, record any leftover socket and verify reclaim and subsequent file handoff. Never delete a live or unidentified socket manually. If restart fails, capture log and socket device/inode, distinguish lock from app socket, and fix only the identified defect. Confirm an active other profile is unaffected.
- [x] Only if the VM exposes a defect, implement the smallest correction at its existing owner: launch operand/cwd rules in `src/main/utils.ts` reusing `launchOperands` and `parseLaunchArguments`; launch-input composition in `src/main/launch-inputs.ts` reusing those helpers; lock and profile selection in `src/main.ts` reusing `parseApplicationProfile`; socket lifecycle in `src/main/pipe-server.ts` reusing `socketIdentity`, `removeSocketIfUnchanged` and `removeStaleSocket`. Retain `handleSecondInstance` → `bringToFront` and `handleLaunchInput` for dispatch. For a readiness race, use the existing ready-aware `open-windows.ts` startup dispatch (`src/main/open-windows.ts:400`); move any new coordination to a focused main-process collaborator if needed. Preserve Windows semantics and the existing service lifecycle.
- [x] Before/after reference for a possible cwd defect, only if observed (the current code already has the desired shape):

  ```ts
  // Before / desired after: preserve Electron's sender cwd, not process.cwd().
  openWindows.handleSecondInstance(stripTestInstanceOptions(commandLine), workingDirectory);
  // Existing downstream rule: path.resolve(cwd, operand)
  ```

  For a proven cleanup defect, the before is `current.close()` followed by asynchronous identity-checked removal (`src/main/pipe-server.ts:101`, `src/main/pipe-server.ts:186`); the after must preserve ownership/identity verification and safe reclaim, with synchronous unlink only when evidence requires it. Choose the exact lifecycle change from the observed failure; do not substitute unconditional `unlinkSync`.
- [x] If code changes are needed, run `npm run typecheck` and `npm run lint` on Windows; preserve the existing Linux CI job. User instruction forbids adding or running tests or test harnesses for this task. Claude repeats the relevant manual VM checks after fixes. Record evidence and results here; leave checklist results to the epic's exit run.

## VM results (Claude, 2026-11-26)

Ubuntu 26.04, GNOME Wayland, dev build. Second launches ran the Electron binary directly with the absolute app path
from another folder, with the session's Wayland and D-Bus environment (`~/second.sh <cwd> <args>` in the VM).

| Check | Result |
|-------|--------|
| Default profile, relative path with a space, from two folders holding the same file name (`h1/hand 01.txt`, `h2/hand 01.txt`) | Pass: each opened its own folder's file in the running window; the second process exits. |
| `--profile us2214` and `--profile=us2214` while the default instance runs | Pass: both files opened in the `us2214` window only; the default instance received nothing. |
| Handoff time, warm, default profile (11 runs) | 174–182 ms (median 178 ms) from the command start to the page existing in the running app; the second process exits in about 280 ms. After the fix below: 187–212 ms (5 runs). |
| Launcher decision | Not needed: far below the 1,000 ms threshold. Decision 5 stands (the launcher stays Windows-only). |
| `kill -9` of the profile's main process | The socket is left behind; the next start reclaims it, listens on a fresh socket, restores its pages, and a handoff works. |
| Quit from the tray | The socket is removed; the restart and a handoff work. R-6 needs no synchronous unlink. |
| Second launch 0.4 s and 1.5 s after a cold start | **Failed: the file was lost** (opened at 8 s). `handleSecondInstance` sent `eOpenFile` before the new window's renderer was listening. **Fixed:** `OpenWindows.handleSecondInstance` now hands non-board inputs to the existing `dispatchNormalInputs`, which waits for the window's `whenReady`; boards keep their direct path. Two 0.4 s runs after the fix both opened their files. |

Not checked: diff and URL second launches, and `--profile-dir`.

## Concerns

- Electron may deliver a second launch before the first window/renderer is ready; `handleSecondInstance` dispatches immediately (`src/main/open-windows.ts:221`), whereas startup dispatch waits for `whenReady` (`src/main/open-windows.ts:400`). Verify this separately with a rapid second launch and fix only if reproduced.
- `--profile-dir` is resolved before lock acquisition against each caller's cwd (`src/main/application-profile.ts:21`, `src/main.ts:37`); different relative directories intentionally select different locks. Socket names use profile name, not directory (`src/main/pipe-server.ts:11`), so do not start two directories with the same profile name when assessing isolation; document any observed collision separately.
- The intended installed `persephone` command is not yet delivered by Phase 2. Direct Electron plus the absolute app path is the developer-build proxy, not a measurement of future packaged startup. Repeat the measurement for a packaged build in Phase 4.
- Guardrails: no new protocol, correlator or socket client; do not grow any roadmap §2.3 god file. No `await import()` or zone-dodging wrapper; fix import direction if needed. No new rule is planned unless a measured defect requires one, with owners and reused helpers specified above.

## Acceptance Criteria

- [x] Checklist 10 and 11: default and named profile handoffs open the intended file in the existing instance, including sender-cwd-relative paths and spaces; no persistent duplicate instance; profiles remain isolated.
- [ ] Existing no-argument recovery, cold-start, diff and URL behavior remain correct; Windows behavior is unchanged.
- [x] Checklist 12: Claude records the measurement method, samples and launcher decision against the stated threshold.
- [x] Checklist 13: normal quit and SIGKILL both allow restart, a functioning socket and subsequent handoff; any stale socket is safely reclaimed without disturbing a live owner.
- [x] If changed, typecheck and lint pass; no new tests or test harnesses. Linux CI remains green.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-2214-linux-single-instance/README.md` | Plan and later VM evidence. |
| `doc/active-work.md`, `doc/epics/EPIC-214.md` | Link this task. |
| `src/main/open-windows.ts` | `handleSecondInstance` routes non-board inputs through `dispatchNormalInputs` (waits for the renderer). |
| `src/main/utils.ts`, `src/main/launch-inputs.ts`, `src/main.ts`, `src/main/pipe-server.ts` | No change: the checks passed. |
| `src/main/main-setup.ts`, `src/main/main-services.ts` | No changes expected; reuse existing forwarding, window dispatch and lifecycle. |
| `src/main/application-profile.ts`, `src/shared/profile-socket.ts`, `launcher/src/main.rs`, `scripts/dev.mjs` | No changes expected; existing rules and Windows launcher remain in place. |
| `doc/epics/EPIC-214-checklist.md` | No change in this planning task; US-2220 records exit results. |
