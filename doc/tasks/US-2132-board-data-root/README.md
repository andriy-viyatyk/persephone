# US-2132: Host: hand a profile-scoped data root to board services

Epic: [EPIC-201: Board data and network isolation](../../epics/EPIC-201.md)

## Goal

Have every host-started process on behalf of a board receive `PERSEPHONE_BOARD_DATA=<board data root>/<board id>`, where the root follows EPIC-201 Decisions 1–3. The host does not create that board folder; boards create it on first write and use the legacy `%LOCALAPPDATA%\Persephone\board-data\<id>` location when the variable is absent.

## Background

- EPIC-201 Decision 1 settles the environment variable and board-specific path; Decision 2 keeps the default profile at `%LOCALAPPDATA%\Persephone\board-data` and puts named/test profiles at `<userData>\board-data`; Decision 3 requires no migration. Named profiles start empty, and users may copy a board folder manually.
- `src/main/module-service/process.ts`, `ModuleServiceProcess.buildServiceEnvironment(boardRoot)`, currently forwards an explicit allowlist from `process.env` and adds `PERSEPHONE_SERVICE`, `PERSEPHONE_BOARD_ROOT`, and `PERSEPHONE_LOCALE`. It does not yet add `PERSEPHONE_BOARD_DATA`.
- `src/main.ts`, `startWithProfile`, sets Electron `userData` for a named profile before `setupMainProcess`; `src/main/application-profile.ts` parses `--profile` and optional `--profile-dir`, and requires a profile name when a directory is supplied.
- `src/main/test-mode/local-app-data.ts`, `redirectTestInstanceLocalAppData()`, redirects a test instance's `LOCALAPPDATA` to a folder beneath `app.getPath("userData")` before child processes start. EPIC-201 Decision 5 retains this behavior.
- `src/main/utils.ts`, `getDataFolder()`, is the existing profile-local helper and returns `<userData>\\data`; it is not the board-data root and should not be changed to make this feature work.
- `src/main/command-runner.ts` owns both board bridge process launch modes: `startJobTo()` (the child behind board `persephone.execute()`) and `startNodeJobTo()` (the utility process behind board `persephone.executeNode()`). Board starts arrive through `src/main/board-host/rpc/events.ts`, which has `entry.root`. `startJobTo()` also has the renderer-owned `start(event, msg)` caller: `src/ipc/main/command-runner-handlers.ts` routes `RunnerChannel.start` to it, including `app.proc.execute()`. Therefore keep `boardRoot` optional on `startJobTo()` so the board-port path supplies it and the app-level path omits it; `startNodeJobTo()` is only called from the board-port runner and may take its board root directly. Do not add the board environment to the renderer-owned `app.proc.execute()` path.
- `src/shared/board/board-manifest-schema.ts` has no manifest `id` field. `src/main/published-boards-service.ts` validates published ids with a private `isSafeBoardId()` rule; `src/renderer/api/boards/board-install.ts` installs to `<targetParentDir>/<catalog id>`, and `board-install-registry.ts` persists that catalog id separately from the root. `src/main/bundled-boards.ts` / `BoardRoot.bundledId()` identify only direct children of the app's `assets/boards` folder. `src/shared/guides/mounted-source.ts` has `boardGuideIdFromRoot()`, which derives a display mount id by sanitizing the root basename; that lossy sanitizer must not define persistent data identity.
- The boards checkout guidance states `boards/<id>/` folder name is the board id. Published install roots are likewise created as `<id>`, so exact root-basename derivation gives the same id for the named published boards and `persephone-boards/boards/<id>` checkout. Proposed owner: a new pure `src/shared/board/board-data-id.ts` helper accepts a `BoardRoot`, takes its exact basename, and validates one path segment using a shared/exported form of the existing catalog safe-id rule (alphanumeric ends; alphanumeric, dot, underscore, or hyphen inside). It returns `undefined` for empty/unsafe ids, never slugifies or invents one. The main-process environment module will reuse `app.getPath("userData")`, `process.env.LOCALAPPDATA`, `isTestInstance()`, and `applicationProfileName()` rather than changing profile setup or test LOCALAPPDATA redirection.
- In the new profile-path helper, the selected root is `%LOCALAPPDATA%\\Persephone\\board-data` only when `applicationProfileName()` is absent and `isTestInstance()` is false; otherwise it is `<userData>\\board-data`. `--profile-dir` always requires a profile name, so that case naturally selects the named-profile path. The host only composes the value; it does not call `mkdir`.
- The module-service suite's fixture root is `integration-test/fixtures/boards/module-service/round-trip-board`; its manifest has no `id`, confirming the folder basename is the available local id. Its service already supports `identity` and request handlers, so add a narrowly-scoped `environment` response for `process.env.PERSEPHONE_BOARD_DATA` and a test in `integration-test/tests/capabilities/module-service/module-service.test.mjs` that compares it with `<ctx.app.main.runtime.paths.userData>/board-data/round-trip-board`.
- Correction to the requested test reference: there is no `LOCALAPPDATA` guard in `integration-test/tests/capabilities/module-service/`. The existing guard is `integration-test/tests/boards/bridge/service-environment.test.mjs`; it queries `app.main.runtime.paths.userData`, checks `<userData>/test-local-app-data`, then verifies the real LocalAppData path differs. Its board fixture is under `integration-test/fixtures/boards/bridge/service-environment-board/`. The planned new assertion belongs in the requested module-service suite and can reuse the same runtime-path lookup and `launch` requirement pattern.
- `doc/standards/integration-tests.md` requires suite files at `integration-test/tests/<area>/<module>/<feature>.test.mjs`, fixture boards under `integration-test/fixtures/boards/<module>/`, `test()` descriptors, isolated `ctx.fixture()` copies, awaited call-tree stand-ins, and `requires: ["launch"]` for owned-instance tests. `assets/guides/agents/web-app-tests.md` documents `ctx.app`, `ctx.expect`, `ctx.call`, and `ctx.waitFor`; the test needs only existing APIs (`ctx.app.main.runtime.paths`, `ctx.app.boards.requestService`, `ctx.expect`).
- `package.json` is currently version `5.0.20`. The service-environment guide's `PERSEPHONE_LOCALE` contract says boards relying on it set `minAppVersion: "5.0.15"`; this feature needs no `minAppVersion` note because boards retain the old `%LOCALAPPDATA%\\Persephone\\board-data\\<id>` fallback when an older host does not set the variable, as EPIC-201 Decision 1 specifies. It adds no `window.persephone` member, so neither `BOARD_BRIDGE_VERSION` nor its history changes.
- Documentation owners to update during implementation: the environment paragraph in `assets/guides/agents/boards/services.md`; the service-environment paragraph in `assets/guides/boards/bridge.md`; the module-service environment description around `doc/architecture/overview.md` lines 512–520; and `doc/architecture/key-files.md` if the new main/shared helper files are added. Each guide should state per-profile storage, no host-created board folder, fallback when absent, no automatic migration, and manual copy of a board folder into a named profile. The bridge guide may mention the value even though it is passed through process environment rather than the `window.persephone` bridge.

## Implementation Plan

### 1. Add the shared board data id rule

- Add `src/shared/board/board-data-id.ts`, the owner of the path-segment rule for board data ids. Export `boardDataIdFromRoot(root: BoardRoot, bundledId?: string): string | undefined`. Use `bundledId` for a bundled board (provided by the existing `bundledBoardId(BoardRoot)` registry helper); otherwise use the exact final folder segment from `root.path`. Validate it with the catalog's existing safe-id rule, promoted from private `isSafeBoardId()` in `src/main/published-boards-service.ts`: `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`. Reuse `BoardRoot`'s already-normalized absolute path and the existing bundled id result; never sanitize or slugify an unsafe value.
- The canonical identity is the board folder name because the boards repository's `CLAUDE.md` defines `boards/<id>/` as the id and published installs are created at `<targetParentDir>/<catalog id>`. The installed registry keeps that catalog id separate, but the root is created with the same name. `board-manifest-schema.ts` does not normalize an `id` field; Translate currently has an extra raw `id: "translate"`, while `claude-agent`, `speech-to-text`, `text-to-speech`, and `wake-word` do not. Their checkout folder names are exactly the requested IDs, and Translate's folder and raw id agree. Do not make an unnormalized optional manifest property the authority. If a local folder name is absent or fails validation, return `undefined`; omit `PERSEPHONE_BOARD_DATA` instead of inventing a name.
- Keep `src/shared/guides/mounted-source.ts`'s `boardGuideIdFromRoot()` out of data identity: it replaces unsafe characters, so it can silently map different roots to the same folder name. Keep published catalog validation on the same safe-id rule by importing it from the shared board module; this makes the owning board rule shared rather than duplicated.

### 2. Add one main-process board-process environment funnel

- Add `src/main/board-process-environment.ts` as the single funnel for board-owned process environments. Export `boardDataPath(boardRoot: string): string | undefined` for path computation and `boardProcessEnvironment(base: NodeJS.ProcessEnv, boardRoot: string): NodeJS.ProcessEnv` for environment composition. The latter currently clones the base, removes any inherited `PERSEPHONE_BOARD_DATA`, then adds the path from `boardDataPath()` when derivation succeeds; otherwise it leaves the variable absent. Use `BoardRoot.tryFrom(boardRoot)` and `boardDataIdFromRoot(root, bundledBoardId(root))` so invalid roots and absent/unsafe ids omit the variable.
- For a named profile or `isTestInstance()`, `boardDataPath()` builds the root with `path.join(app.getPath("userData"), "board-data")`. Otherwise use `path.join(process.env.LOCALAPPDATA, "Persephone", "board-data")` only when `LOCALAPPDATA` is absolute; if missing or relative, return `undefined` rather than produce a relative path. Append the validated id. Do not create either root or board folder.
- Reuse `applicationProfileName()` from `src/main/application-profile.ts`, `isTestInstance()` from `src/main/test-mode/instance-options.ts`, and `app.getPath("userData")`. `applicationProfileName()` reflects both `--profile` forms; `--profile-dir` cannot appear without a name, as `parseApplicationProfile()` enforces. Leave `startWithProfile()` and `redirectTestInstanceLocalAppData()` as they are. Test instances still redirect `LOCALAPPDATA` to `<userData>/test-local-app-data`; their board-data root is independently `<userData>/board-data`.
- Call `boardProcessEnvironment()` for the service's sanitized environment in `src/main/module-service/process.ts` and for board runner environments in `src/main/command-runner.ts`. `startJobTo()` keeps an optional `boardRoot` because it serves both board-port starts and renderer-owned `app.proc.execute()`; the board-port caller passes `entry.root`, while `command-runner.start(event, msg)` omits it. `startNodeJobTo()` is only called by `src/main/board-host/rpc/events.ts`, so pass that caller's `entry.root`. Compose `process.env` and `opts.env` first, then apply the shared helper so callers cannot override the host value. The helper explicitly removes an inherited value if derivation fails.
- US-2136 will add its test-instance `USERPROFILE`, `APPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `PATH` redirects inside `boardProcessEnvironment()`; that follow-up extends this function and does not add another environment call site. This lets the existing service and board-runner calls receive the sandbox consistently.

Current service setup:

```ts
environment.PERSEPHONE_BOARD_ROOT = boardRoot;
environment.PERSEPHONE_LOCALE = getActiveLocale();
return environment;
```

Planned service setup:

```ts
environment.PERSEPHONE_BOARD_ROOT = boardRoot;
environment.PERSEPHONE_LOCALE = getActiveLocale();
return boardProcessEnvironment(environment, boardRoot);
```

Current process runner environment:

```ts
env: { ...process.env, ...(opts?.env ?? {}) },
```

Planned board runner behavior keeps that merge for non-board callers and passes the merged environment through `boardProcessEnvironment()` when `boardRoot` is supplied:

```ts
const environment = { ...process.env, ...(opts?.env ?? {}) };
env: boardRoot ? boardProcessEnvironment(environment, boardRoot) : environment,
```

Use direct static imports between main and `src/shared/board/`; do not add `await import()`, a wrapper for an import-zone exception, a new zone exception, or code to a roadmap §2.3 god file. `src/main/board-process-environment.ts` owns the board process environment and profile path; the shared board helper owns only id validation/derivation.

### 3. Add the integration coverage in the module-service suite

- Update `integration-test/fixtures/boards/module-service/round-trip-board/scripts/service.mjs` so an `{ op: "environment" }` request returns `{ boardData: process.env.PERSEPHONE_BOARD_DATA ?? null }`. Keep the value synthetic and do not write into it.
- Add a `serviceTest()` case to `integration-test/tests/capabilities/module-service/module-service.test.mjs` and import `node:path`. Trust the `round-trip-board` fixture and call `ctx.app.boards.requestService(root, { op: "environment" })`. Read `ctx.app.main.runtime.paths.userData`; assert `sameRoot(result.boardData, path.join(userData, "board-data", "round-trip-board"))` is true. This verifies the path is inside the test profile and ends in the fixture folder id. Reuse the file's `launch` requirement, `fixtureBoard()`, and `finally` cleanup pattern. Codex writes this test during implementation; Claude runs it.
- The service fixture needs only a response operation; no page bridge API or test harness change is required. The existing `LOCALAPPDATA` assertion stays in `integration-test/tests/boards/bridge/service-environment.test.mjs`.

### 4. Update the documented contract

- In `assets/guides/agents/boards/services.md`, update the sanitized environment paragraph to list `PERSEPHONE_BOARD_DATA`. Explain default versus named/test profile roots, that the folder is per profile and not created by Persephone, and that a board without the variable (older host) falls back to `%LOCALAPPDATA%\\Persephone\\board-data\\<id>`. State named profiles start empty with no migration and the user can copy one board folder by hand. No `minAppVersion` requirement is needed because the fallback preserves old-host behavior.
- In `assets/guides/boards/bridge.md`, update the service environment paragraph similarly, while clarifying it is a process environment value rather than a new `window.persephone` member.
- In `doc/architecture/overview.md`, add the board data environment and its profile selection to the existing module-service spawn environment description around lines 512–520; document that no bridge protocol/version change occurs.
- In `doc/architecture/key-files.md`, add rows for `src/main/board-process-environment.ts` and `src/shared/board/board-data-id.ts`, describing their respective environment/path and safe identity ownership. Note that US-2136 extends `boardProcessEnvironment()` rather than adding a new call site.
- Do not edit `src/shared/board-bridge-version.ts` or add a history entry. No `window.persephone` surface changes; `PERSEPHONE_LOCALE` in `services.md` is the precedent for an environment-only contract.

### Files that do not change

- `src/main.ts` and `src/main/application-profile.ts`: profile startup and parsing already set up the required `userData` before main services start.
- `src/main/test-mode/instance-options.ts` and `src/main/test-mode/local-app-data.ts`: test detection and the existing `LOCALAPPDATA` redirect remain in force.
- `src/main/utils.ts` (`getDataFolder()`) and `src/main/board-storage.ts`: board bridge JSON storage under `<userData>/data/board-storage` is distinct from board-owned service data.
- `src/ipc/`, `src/board-shim/`, `src/shared/board-bridge-version.ts`, and `window.persephone` declarations: no protocol or bridge change.
- `C:\projects\persephone-boards\boards\`: no board source or language-pack edits are part of this host task, so board version/changelog bumps do not apply here.
- `doc/active-work.md` and `doc/epics/EPIC-201.md`: EPIC-201 already links US-2132; the user owns both tracking files.
- Unit-test directories and harnesses: no unit tests or non-integration harnesses are planned.

## Concerns

No product decisions remain open: path selection, fallback, no migration, and no host-created folder are settled by EPIC-201 Decisions 1–3. The existing test guide and service fixture are sufficient for the planned assertion. One path detail was confirmed during investigation: the existing `LOCALAPPDATA` guard is under `tests/boards/bridge/`, not in the module-service suite as the prompt suggested; the new variable assertion remains in the explicitly requested module-service suite.

## Acceptance Criteria

- [x] Each host-started board service and board-launched process gets the same absolute board data path in `PERSEPHONE_BOARD_DATA` when the board id can be derived safely.
- [x] Default, named (`--profile`, with or without `--profile-dir`), and test-instance paths follow EPIC-201 Decisions 1–3; the host does not create the board data folder.
- [x] Published and local checkout forms of supported boards resolve to the exact folder ids they already use (`translate`, `claude-agent`, `speech-to-text`, `text-to-speech`, `wake-word`); an absent or unsafe id omits the variable.
- [x] Documentation describes per-profile storage, no automatic migration, manual folder copying, and fallback to the legacy path when the variable is absent.
- [x] An integration test is implemented under `integration-test/tests/capabilities/module-service/` for a service observing the test-profile path ending in its board id. Claude runs it.
- [x] No `window.persephone` API change is made; `BOARD_BRIDGE_VERSION` needs no bump.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/board/board-data-id.ts` | New shared owner for exact folder-id derivation and safe path-segment validation. |
| `src/main/board-process-environment.ts` | New main-process owner for profile-specific board data paths and the shared environment funnel that US-2136 extends. |
| `src/main/published-boards-service.ts` | Reuse the shared board-id validator instead of its private duplicate. |
| `src/main/module-service/process.ts` | Add the shared data path to the existing sanitized service environment. |
| `src/main/command-runner.ts` | Apply the same environment helper to board `execute()` and `executeNode()` starts when given a board root. |
| `src/main/board-host/rpc/events.ts` | Pass the owning board root into the two process runner entry points. |
| `integration-test/fixtures/boards/module-service/round-trip-board/scripts/service.mjs` | Expose the service's data path for the test assertion. |
| `integration-test/tests/capabilities/module-service/module-service.test.mjs` | Add the owned-instance service environment assertion. |
| `assets/guides/agents/boards/services.md` | Document the variable, profile roots, fallback, and no-migration behavior. |
| `assets/guides/boards/bridge.md` | Document the process environment contract without changing the bridge API. |
| `doc/architecture/overview.md` | Record the profile-scoped service environment behavior. |
| `doc/architecture/key-files.md` | Index the two new owner modules. |
| `doc/tasks/US-2132-board-data-root/README.md` | This implementation plan. |
