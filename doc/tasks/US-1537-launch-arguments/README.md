# US-1537: Launch arguments parsed once; cold-start URLs use the running-instance route

Epic: [EPIC-115 — Platform roadmap clean-up](../../epics/EPIC-115.md#us-1537-launch-arguments-parsed-once-a-cold-start-url-takes-the-same-route-as-a-running-instance-url)

## Goal

Use one main-process launch-input parser for cold starts, Electron's `second-instance` event, and the launcher pipe. Open cold-start URLs through the same internal-browser route used by a running instance, and support all file, URL, and diff operands consistently from each entry point.

## Background

Current behavior verified in source:

- `src/ipc/main/window-handlers.ts` reads only `process.argv[app.isPackaged ? 1 : 2]`, then classifies that one value as an HTTP(S) URL or existing file/folder. It does not recognize `diff` plus two paths or open multiple cold-start operands.
- `src/main/main-setup.ts` reads `commandLine[2]` in `second-instance`. It recognizes HTTP(S), `diff <path1> <path2>`, and a file/folder. Relative paths use the event's `workingDirectory`; diff operands must both be files.
- `src/main/pipe-server.ts` has another URL check. `OPEN <arg>` opens a URL or existing file/folder; `DIFF <path1>\t<path2>` opens two existing files. The launcher resolves paths before sending them.
- `launcher/src/main.rs` resolves relative inputs against the launcher's current directory. Its pipe forms are `OPEN <absolute-path-or-url>` and `DIFF <absolute-path1>\t<absolute-path2>`. Its cold-start fallback sends `diff <absolute-path1> <absolute-path2>` for a diff, or spawns `persephone.exe` with **all** resolved arguments (`spawn_electron(&resolved)`). Cold start currently reads only one argument, so opening every supplied operand is a behavior fix.
- `scripts/dev.mjs` starts Electron as `spawn(electronPath, [".", ...process.argv.slice(2)])` (around line 155). Thus `npm start -- <arg>` produces `[electron.exe, ".", <arg>]`; packaged launch shape is `[persephone.exe, <arg>]`. The second instance is the same app kind as the primary instance.
- Use exactly one operand selector in `src/main/utils.ts`: `launchOperands(argv: string[]): string[]` returns `argv.slice(1).filter(a => !a.startsWith("--"))`, then drops the first remaining operand when `process.defaultApp` is true. This skips the executable, Chromium switches, and the dev app path. Electron's Chromium switches are single tokens (`--name` or `--name=value`), so filtering switch tokens cannot consume a following launch operand. `process.defaultApp` is the precise signal for `electron <appPath>`; `!app.isPackaged` is not an equivalent selector. Both cold start and `second-instance` use this helper.
- The cold-start URL route is `PagesPersistenceModel.openStartupInputs()` → `PagesLifecycleModel.handleExternalUrl()` → `sendOpenRawLink()` without `browserMode: "internal"`. The running-instance route is `RendererEventsService.handleExternalUrl()`, which calls `openRawLink` with `{ browserMode: "internal" }` to prevent an external-shell loop. `PagesPersistenceModel.openStartupInputs()` also calls `this.model.checkEmptyPage()` after opening its inputs, including when there were none.
- `src/renderer/api/app.ts` currently creates `const rendererEvents = new RendererEventsService()` inside `app.initEvents()` and does not retain the instance. Retain it on the `App` instance so `app.openStartupInputs()` can call its public launch-input dispatcher after `initEvents()`.
- Startup opening is currently delegated through `PagesModel` to `PagesPersistenceModel`, although it is not persistence. `src/renderer.ts` already calls `app.initEvents()` before `app.openStartupInputs()`; keep that order.
- Main exposes separate one-shot `getFileToOpen` and `getUrlToOpen` IPC endpoints today. Replace them with one typed list of startup inputs. Put the serializable `LaunchInput` union in `src/shared/launch-input.ts`, which is importable on both sides and does not pull `src/main/utils.ts`'s Node/Electron imports into the renderer.
- No board-visible API or service protocol changes: do **not** bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts`.

Electron references: [App API — `second-instance` and `requestSingleInstanceLock`](https://www.electronjs.org/docs/latest/api/app#event-second-instance), [Deep Links tutorial — cold and second-instance URL handling](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app).

### Before → after

```ts
// Before: entry points classify separately and use fixed indexes.
const startupArg = process.argv[app.isPackaged ? 1 : 2];
const arg = commandLine[2];
if (argument.startsWith("http://") || argument.startsWith("https://")) { /* ... */ }
```

```ts
// After: both argv sources select operands the same way, then share one parser.
const operands = launchOperands(argv);
const inputs = parseLaunchArguments(operands, cwd);
// LaunchInput[]: file | url | diff
```

## Implementation plan

1. [x] **Define the shared type in `src/shared/launch-input.ts`.** Export the serializable discriminated union:
   ```ts
   type LaunchInput =
       | { kind: "file"; path: string }
       | { kind: "url"; url: string }
       | { kind: "diff"; firstPath: string; secondPath: string };
   ```
   Import it from main utils, IPC API types, and the renderer event service; do not import `src/main/utils.ts` in renderer code.
2. [x] **Add `launchOperands(argv: string[]): string[]` and `parseLaunchArguments(operands: string[], cwd: string): LaunchInput[]` to `src/main/utils.ts`.** `launchOperands` must implement exactly `argv.slice(1).filter(a => !a.startsWith("--"))`, followed by dropping the first remaining operand when `process.defaultApp` is true. `parseLaunchArguments` walks operands in order: when the first operand is `diff` (case-insensitive), consume `diff`, `a`, and `b` as one diff input; otherwise parse each operand into zero or one file/URL input. Normalize file and diff paths to absolute paths relative to the supplied cwd. Only HTTP(S) is a URL; file/folder validation uses `isValidOpenPath`, and diff operands use `isValidFilePath`. Unsupported or invalid operands produce no input. This plural signature supersedes the singular `parseLaunchArgument(arg, cwd)` sketch in the EPIC-115 direction.
3. [x] **Use the shared selector and parser for cold start in `src/ipc/main/window-handlers.ts`.** Pass `process.argv` through `launchOperands`, then parse all operands with `process.cwd()`. Store the resulting `LaunchInput[]` for a single one-shot `getStartupInputs()` IPC read. This preserves multiple cold-start file/URL inputs and supports cold-start diff.
4. [x] **Use the same selector and parser for `second-instance` in `src/main/main-setup.ts`.** Pass Electron's `commandLine` through `launchOperands`; parse against the event's `workingDirectory`, not the primary process cwd. Call `openWindows.bringToFront()` before dispatch even when the operand list is empty, preserving current second-instance activation behavior. Current `commandLine[2]` is very likely wrong in a packaged invocation: the packaged shape puts its first operand at index 1, so index 2 skips it unless Chromium inserts a switch at index 1. Either shape is handled by the new selector.
5. [x] **Use the shared parser for pipe messages in `src/main/pipe-server.ts`.** Call `parseLaunchArguments([argument], process.cwd())` for `OPEN`; call `parseLaunchArguments(["diff", firstPath, secondPath], process.cwd())` for tab-separated `DIFF`. The launcher already makes these paths absolute. Add `openWindows.handleLaunchInput(input)` in `src/main/open-windows.ts`, switching to the existing `handleOpenFile`, `handleOpenUrl`, or `handleOpenDiff` method. `second-instance` keeps its unconditional `bringToFront()`; the pipe brings the window forward only when parsing yields a valid input, then dispatches each input. Preserve `SHOW` behavior.
6. [x] **Replace the startup IPC contract.** In `src/ipc/main/core-handlers.ts`, `src/ipc/api-types.ts`, and `src/ipc/renderer/api.ts`, remove `getFileToOpen`/`getUrlToOpen` and add one one-shot `getStartupInputs(): Promise<LaunchInput[]>` endpoint. Use the shared type from `src/shared/launch-input.ts` throughout.
7. [x] **Centralize renderer launch dispatch in `src/renderer/api/internal/RendererEventsService.ts`.** Add one public `openLaunchInput(input: LaunchInput): Promise<void>` method. It switches on `kind`: file calls the existing guarded raw-link path with `createLinkData(path)`; URL calls it with `createLinkData(url, { browserMode: "internal" })`; diff runs the existing guarded `pagesModel.openDiff({ firstPath, secondPath })` body. Make the `eOpenFile`, `eOpenDiff`, and `eOpenExternalUrl` subscriptions adapt their payloads and delegate to this method. Leave `eOpenUrl`/`handleOpenUrl` unchanged; that is the in-app URL route and intentionally has no `browserMode` option.
8. [x] **Have `app.openStartupInputs()` use the retained service instance.** In `src/renderer/api/app.ts`, add a private `RendererEventsService` instance field, assign the instance created in `app.initEvents()`, then fetch `api.getStartupInputs()` and call `this.rendererEventsService.openLaunchInput(input)` once per input. Each dispatch is guarded inside the service, so a failed item does not block later items. After the loop, call `pages.checkEmptyPage()` exactly once, even if the input list is empty. Keep `src/renderer.ts`'s existing `initEvents()` → `openStartupInputs()` order.
9. [x] **Remove launch responsibilities and dead delegates.** Remove `openStartupInputs()` from `src/renderer/api/pages/PagesPersistenceModel.ts` and its delegate from `src/renderer/api/pages/PagesModel.ts`; retain `PagesPersistenceModel.init()` and its page restoration behavior. Delete `PagesModel.handleExternalUrl` and `PagesLifecycleModel.handleExternalUrl`; current-source search found no other callers, script facade, or `.d.ts` contract. Keep `PagesModel.checkEmptyPage()` available for the app-level startup sequence.
10. [x] **Leave `launcher/src/main.rs` unchanged.** Adapt its existing `OPEN`, tab-separated `DIFF`, and cold-start `diff` forms in the main-process parser and dispatch.
11. [ ] **Live verification in dev (user-owned).** First stop all running Persephone instances (the single-instance lock prevents a new cold-start process while one is open). For a cold URL, run `npm start -- "https://example.com"`; for second-instance URL/file/diff, start the app normally, then run `& .\node_modules\.bin\electron.cmd . "https://example.com"`, `& .\node_modules\.bin\electron.cmd . .\doc\active-work.md`, and `& .\node_modules\.bin\electron.cmd . diff .\doc\active-work.md .\doc\epics\EPIC-115.md`. Use a file path containing spaces too. Repeat each changed running-instance message path twice. `scripts/dev.mjs` restarts Electron with the same args after a main-process rebuild, so under a cold `npm start -- <url>` the URL reopens after each such rebuild; this is expected in dev. Verify the cold URL reaches `openRawLink` with `browserMode: "internal"` and opens internally rather than calling `shell.openExternal`.

Implementation progress: steps 1�10 are implemented. `npm run typecheck`, `npm run lint`, and `npm run build-prod` all passed. Step 11 live application checks are left for the user as requested.

## Concerns / Open questions

- **Resolved — argv shape and selector:** packaged argv is `[persephone.exe, ...args]`; dev argv is `[electron.exe, appPath, ...args]`. `launchOperands(argv)` applies the specified slice/filter rule and removes the first positional app path only when `process.defaultApp` is true. The same helper handles primary cold start and the second instance, whose launch kind matches the primary. Chromium switches use a single `--name[=value]` token, so filtering them does not drop a neighboring operand.
- **Resolved — current packaged second-instance index:** `commandLine[2]` likely skips a packaged first operand at index 1; if a Chromium switch occupies index 1, the fixed index is still unstable. The shared selector handles both packaged and dev command lines.
- **Resolved — path base:** cold start uses its process `process.cwd()`; second-instance uses that event's `workingDirectory`; pipe paths are already resolved against the launcher's cwd and are absolute. Relative diff paths use the same caller-specific cwd and both must exist as files.
- **Resolved — diff and multiple operands:** argv `diff a b` and pipe `DIFF a\tb` normalize to one `{ kind: "diff", firstPath, secondPath }`. Otherwise, each cold-start operand is parsed and opened in order. This fixes the launcher's current cold-start behavior where all resolved args are passed but only the first is read.
- **Resolved — renderer ownership and page fallback:** `app.initEvents()` creates `RendererEventsService` as a local today; retain it on `App` so startup uses its public `openLaunchInput`. After all guarded inputs, call `pages.checkEmptyPage()` once, including the zero-input case.
- **Resolved — `additionalData`:** do not add it in this task. A structured payload could preserve an app-generated second-instance argument set, but current launches do not provide it and OS launches cannot be required to do so. The common argv selector plus parser handles both launch shapes without adding another encoding.
- **Board contract:** launch plumbing does not change anything a board sees; `src/shared/board-bridge-version.ts` needs no change.

## Verification (live, dev, 2026-09-28)

Build: `npm run typecheck`, `npm run lint`, `node scripts/build-prod.mjs` all pass.

- **second-instance** (`electron.exe <appPath> <arg>` against the running dev app, each twice): two HTTPS URLs opened as tabs of the internal browser page; a *relative* file path with a space (`"file one.txt"`, resolved against the second process's cwd) opened once and the second send refocused it; `diff a b` opened both files grouped.
- **launcher pipe** (raw `OPEN url` / `OPEN file` / `DIFF a<TAB>b` messages written to the named pipe, each twice): URLs opened internally; files and the diff opened, the second send of each deduped. (The test used an 8.3 short path, `ANDRII~1`, so those pages did not dedupe against the long-path pages opened earlier; the real launcher canonicalizes paths, so this is a test artefact, not a regression.)
- **cold start** (`npm start -- <args>`): an HTTPS URL opened in an internal browser page with the user's pages restored; the same repeated with `link-open-behavior` temporarily set to `default-browser` while the OS https handler is `PersephoneURL` (the loop scenario) — it opened internally and no `persephone.exe` was spawned (setting restored afterwards). `diff <a> <b>` cold start opened both files grouped (previously dropped). Two operands (a relative file + a URL) both opened (previously only the first).

### Not verified

- **Packaged argv shape.** The packaged executable cannot be exercised from dev. Reasoning: packaged argv is `[persephone.exe, ...operands]`, dev is `[electron.exe, <appPath>, ...operands]`; `launchOperands` drops `--` switches (Chromium switches are single `--name[=value]` tokens) and, only when `process.defaultApp` is true, the app path. The old second-instance handler's fixed `commandLine[2]` would skip a packaged first operand unless Chromium had inserted a switch at index 1; the new rule is correct for either shape. Check once on the next packaged build: `persephone.exe https://example.com` with Persephone already running, and `persephone-launcher.exe diff a b`.
- **The real OS default-browser loop in a packaged install** (a link clicked in another app while Persephone is closed). Dev verified the in-process condition — the startup URL goes to `openRawLink` with `browserMode: "internal"` and never reaches `shell.openExternal`.

## Acceptance criteria

- Cold start and `second-instance` both call one `launchOperands(argv)` implementation and one `parseLaunchArguments(operands, cwd)` implementation; the launcher pipe also uses the shared parser.
- The parser returns the shared `LaunchInput[]` contract for file, URL, and diff; packaged/dev executable and app-path operands and Chromium switches are not treated as user inputs.
- All cold-start operands forwarded by the launcher open in order; `diff a b` is consumed as one diff input. Existing file/folder, HTTP(S), and two-file diff inputs work across cold start, second instance, and pipe.
- Relative paths resolve against cold-start `process.cwd()`, second-instance `workingDirectory`, or the launcher-resolved absolute pipe path. Invalid files and diff operands are ignored using the current file/folder validation rules.
- `openWindows.handleLaunchInput()` dispatches file, URL, and diff inputs through the existing main-window routes. Second-instance still activates the window with no operands; the pipe activates it only for parsed valid inputs.
- `eOpenFile`, `eOpenDiff`, and `eOpenExternalUrl` delegate to `RendererEventsService.openLaunchInput`; `eOpenUrl` remains unchanged. Startup calls that same public method through the retained `App` service instance.
- `pages.checkEmptyPage()` runs exactly once after all startup inputs, including when there are none. Persistence remains responsible for restore/save only; both `PagesModel` and `PagesLifecycleModel` external-URL delegates are removed.
- Cold-start URL launch supplies `{ browserMode: "internal" }` and opens inside the app in dev. Packaged argv and real OS-default-browser loop behavior are explicitly tracked under **Not verified**.
- File, URL, and diff changed message paths are each sent twice to an already-open dev instance. `BOARD_BRIDGE_VERSION` remains unchanged.

## Files Changed Summary

| File | Planned change |
|------|---------------|
| `src/shared/launch-input.ts` | Define renderer-safe `LaunchInput` union. |
| `src/main/utils.ts` | Add exact `launchOperands(argv)` selector and `parseLaunchArguments(operands, cwd)`. |
| `src/ipc/main/window-handlers.ts` | Parse all cold-start operands using the shared selector/parser and expose startup inputs. |
| `src/main/main-setup.ts` | Use shared selector/parser and second-instance `workingDirectory`; dispatch each input. |
| `src/main/pipe-server.ts` | Adapt `OPEN` and `DIFF` to shared parser; dispatch valid inputs. |
| `src/main/open-windows.ts` | Add `handleLaunchInput(input)` to route the union through existing handlers. |
| `src/ipc/main/core-handlers.ts` | Expose one-shot typed startup inputs. |
| `src/ipc/api-types.ts` | Replace separate file/URL getter contracts with `getStartupInputs()`. |
| `src/ipc/renderer/api.ts` | Add `getStartupInputs()`. |
| `src/renderer/api/app.ts` | Retain `RendererEventsService`, dispatch startup inputs, then call `checkEmptyPage()` once. |
| `src/renderer/api/internal/RendererEventsService.ts` | Add public `openLaunchInput`; delegate file/diff/external URL subscriptions to it. |
| `src/renderer/api/pages/PagesModel.ts` | Remove `handleExternalUrl` and `openStartupInputs` delegates. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Remove `handleExternalUrl`. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Remove launch-input opening; retain restoration and persistence. |
| `launcher/src/main.rs` | **No change:** existing pipe and argv shapes are adapted by main. |
| `src/shared/board-bridge-version.ts` | **No change:** no board-visible contract changes. |
| `src/renderer.ts` | **No change:** existing event initialization order is correct. |
