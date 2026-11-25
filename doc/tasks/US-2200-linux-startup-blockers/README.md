# US-2200: Startup blockers

**Epic:** [EPIC-212](../../epics/EPIC-212.md) · **Status:** Planned

## Goal

Enable Linux local file open, edit and save, and remove the startup and missing-helper blockers identified in EPIC-212 while preserving Windows behavior.

## Background

[US-2198](../US-2198-linux-dev-environment/README.md) F5 observed that local files cannot open: path validation rejects POSIX paths and `file:///` loses its root; a local patch enabled open/edit/save. F6 observed a Windows pipe-shaped socket file in the working directory. F7 confirmed the normal data folder comes from Electron; F8 did not exercise named-profile or board identity calls. Epic decisions 1–8 govern the target, platform ownership, data folder, launcher, live checks and Windows compatibility.

- `src/renderer/content/link-utils.ts` owns `isPlausibleFilePath`, `normalizeFileUrl`, `toFileUrl` and `resolveUrlToPipeDescriptor`. The first accepts only drive/UNC paths; the second slices eight characters from `file:///`. `toFileUrl` already uses Node `pathToFileURL` after validation. `src/renderer/content/parsers.ts` calls the first two for raw file links; its archive parser precedes the fallback and also normalizes file URLs. `src/renderer/core/utils/file-path.ts` wraps native Node `path`, including `fpIsAbsolute`, and has archive-aware helpers.
- `src/main/main-services.ts` starts `src/main/pipe-server.ts`; `launcher/src/main.rs` uses the pipe for show/open handoff. Electron's `second-instance` handler is in `src/main/main-setup.ts`. `src/main/test-mode/profile.ts` also probes the profile pipe for the running-profile guard and attach in `src/main/test-mode/controller.ts`.
- `src/renderer/core/utils/startup-data-path.ts` falls back to `APPDATA`; `src/main/open-window.ts` already injects `getDataFolder()` into renderer arguments. `src/main.ts` and `src/main/open-window.ts` own the identity calls.
- `src/shared/platform.ts` exports `isWindows`, `isLinux` and `isMac`; `src/shared/platform-features.ts` marks `screen.snip` and `memory.mnemeSidecar` unavailable on Linux. Static availability is not a binary-existence probe.

- `src/renderer/api/pages/open-url-validation.ts` independently accepts only Windows/UNC bare paths, before the pipeline. `src/renderer/core/utils/path-utils.ts` already resolves related paths with native `fpResolve` and Node `pathToFileURL`; its wiki-root semantics are intentional. `fpNormalizeForCompare` in `file-path.ts` and `comparePathKey` in `src/main/utils.ts` replace backslashes unconditionally, although backslash is a valid POSIX filename character. Record this identity issue for US-2201; it does not block normal opening and changing identity keys affects wider consumers.
- `electron-builder.yml` bundles `persephone-launcher.exe`, `persephone-test.exe`, `persephone-snip.exe`, and `mneme.exe`. The first two are Windows entry points, not spawned application features. The snip binary also serves file clipboard, clipboard watching, native-dialog inspection and Windows SSO. `SidecarProcess` reports spawn errors as failed results; `snip-service.ts` returns null on child errors; `clip-service.ts` returns empty/false but its write path also writes to child stdin. `native-dialog-tracker.ts` handles spawn failures; `windows-sso.ts` already checks the platform and returns no cookies on failure. Clipboard watcher failure sets an error status in `src/main/clipboard-service.ts`.

## Implementation Plan

- [x] **File inputs and URL conversion - owner `src/renderer/content/link-utils.ts`; reuse `isWindows` from `src/shared/platform.ts`.** In `normalizeFileUrl`, keep the Windows branch byte-for-byte unchanged; off Windows slice seven characters for `file:///` so the root `/` remains. Keep `decodeURIComponent` and its current error behavior. In `isPlausibleFilePath`, add `if (!isWindows && path.startsWith("/")) return true;` and update its Windows-only doc comment. Keep the existing Windows drive/UNC branches. `toFileUrl` already uses Node `pathToFileURL`. `src/renderer/content/parsers.ts` splits URL fragments before normalization, and its archive parser retains the existing `!entry` handling. `src/renderer/api/pages/descriptor-migrations.ts`, `src/renderer/editors/markdown/markdown-nav.ts`, and `resolveFilePipeDescriptor` already consume the normalized path and need no changes. File URL hardening beyond the root fix is out of scope.

  ```ts
  // Before: path = path.slice(8); // file:///C:/...
  // After: keep the Windows slice(8); off Windows use slice(7).
  // Before: only drive and UNC checks.
  // After: if (!isWindows && path.startsWith("/")) return true;
  ```

- [x] **Public validation - owner `src/renderer/api/pages/open-url-validation.ts`; reuse `isPlausibleFilePath` from `link-utils.ts`.** Replace its duplicate `isWindowsOrUncPath` predicate with the shared recognition rule and update `PIPELINE_INPUT_FORMS` to describe absolute local paths. Preserve existing HTTP, file URL, data and registered-scheme validation and Windows acceptance; reject invalid input before dispatch. Confirm `pages.openUrl` and raw-link callers both reach the same path handling.

- [x] **Pipe - owner `src/main/pipe-server.ts`; reuse `isWindows`, `getPipePath`, the existing handler and `src/main/main-services.ts` lifecycle.** Keep the Windows named-pipe path and behavior unchanged. Off Windows, `getPipePath(profile)` returns ``path.join(process.env.XDG_RUNTIME_DIR, `persephone${profile ? `-${profile}` : ""}.sock`)`` when `XDG_RUNTIME_DIR` is set, otherwise `undefined`. The runtime directory is per-user and 0700; `/run/user/<uid>` is well below the approximately 107-byte Unix socket path limit. `startPipeServer` logs once and skips listen if it is unset. In `src/main/test-mode/profile.ts`, reject an undefined path with `cannot probe profile: XDG_RUNTIME_DIR is not set`, so the running-profile guard and `--attach` fail closed only in that case. Preserve the existing connect-first EADDRINUSE check: only after nobody answers, unlink the stale Unix socket file before retrying listen; never unlink a live server. After closing an owned Unix server, unlink its socket as needed, handling an already-removed file and avoiding removal of a replacement server's socket; Windows cleanup remains unchanged. Reuse the same messages and handler; no new protocol. The Windows launcher remains Windows-only; on Linux test-mode probing and future callers use the socket, while normal launch handoff uses Electron's lock and `second-instance`.

  ```ts
  // Before: getPipePath always returns the Windows named-pipe path.
  // After: if (isWindows) return the unchanged Windows path;
  //        return XDG_RUNTIME_DIR ? path.join(XDG_RUNTIME_DIR, profileSocketName) : undefined;
  ```

- [x] **Startup data - owners `src/renderer/core/utils/startup-data-path.ts` and `index.html`'s early theme script; reuse `STARTUP_DATA_DIR_ARG` from `src/shared/application-profile.ts` and main's `getDataFolder()` in `src/main/utils.ts`.** Require the present, nonempty injected argument in `getStartupDataPath` and throw a descriptive startup configuration error if missing; remove its `APPDATA` fallback and unused `fpJoin` import. `index.html` also reads `APPDATA` for `appSettings.json` and custom themes before the bundle loads: read the same `--persephone-data-dir=` argument in that inline script and join the settings and theme paths to it, retaining its existing catch/default background. This corrects its current profile-unaware first-paint lookup; normal renderer data remains Electron-selected. The inline script cannot import the TypeScript constant, so keep its argument prefix exactly synchronized with `STARTUP_DATA_DIR_ARG`; the existing inline-script hash build handles the changed script.

  Verified renderer entries: `src/main/open-window.ts` is the only injector and loads `index.html` / `src/renderer.ts`; normal, additional and board windows are created through `src/main/open-windows.ts` as `OpenWindow`; tools shown within the main UI use that renderer, and `src/renderer.ts` imports i18n and themes that consume `startup-environment.ts`. `getStartupDataPath` is called only by `src/renderer/core/startup-environment.ts`. The only other `BrowserWindow` constructor is `src/main/audio-service.ts`: it loads `audio.html` / `src/renderer/audio/audio-window.ts`, whose audio/shared dependency graph does not import startup-environment; it is not an `OpenWindow` and needs no argument. Screen snip/overlay belongs to the external `persephone-snip.exe` (`src/main/snip-service.ts`), not an Electron renderer. The test controller forks a utility process (`src/main/test-mode/controller.ts`); `src/test-host/launcher.ts` launches the app, whose windows follow the `OpenWindow` path. Board and browser guest frames load their own content, not the main renderer bundle; browser guest popups are created by Electron through `src/main/browser/BrowserGuest.ts` and `src/main/browser/popup-policy.ts` and likewise load guest content, not the application bundle. There are no other `BrowserWindow` constructors in `src/`; no additional injection site is needed.

  ```ts
  // Before: argument ? argument.slice(STARTUP_DATA_DIR_ARG.length) : fpJoin(process.env.APPDATA!, "persephone", "data")
  // After: require the injected nonempty value; return argument.slice(STARTUP_DATA_DIR_ARG.length).
  ```

- [x] **Identity - owners `src/main.ts` and `src/main/open-window.ts`; reuse `isWindows` from `src/shared/platform.ts`.** Guard `app.setAppUserModelId` inline without guarding profile directory/session setup. Guard both `setAppDetails` calls inline; keep `setIcon`, validation, icon writing, and other board behavior intact. The calls have different payloads, so a collaborator would not share meaningful construction logic; `open-window.ts` is not a refactoring roadmap section 2.3 god file. Preserve call arguments and order on Windows.

  ```ts
  // Before: app.setAppUserModelId(profileId);
  // After:  if (isWindows) app.setAppUserModelId(profileId);
  // Likewise guard both existing setAppDetails calls inline.
  ```

- [x] **Helpers - owners `src/main/mneme-service.ts`, `src/main/snip-service.ts` and their existing IPC/service entry points; reuse `getPlatformFeature`, `SidecarProcess`, and the existing null/status results.** Gate `startMneme` (therefore restart and direct IPC calls) on `memory.mnemeSidecar`, returning a non-running `MnemeStatus` with the availability reason before mkdir/spawn. `src/ipc/main/clipboard-handlers.ts` already gates `startScreenSnip`; guard the service itself too before hiding windows, returning null off-platform. Existing `SidecarProcess` and snip error handlers already handle a missing Windows executable; retain their Windows behavior and surface their failure instead of crashing. Audit `clip-service.ts`'s stdin error on a missing child and handle it without an unhandled `error` event, resolving false. Verify `clipboard-service.ts` watcher, `native-dialog-tracker.ts`, and `windows-sso.ts` existing failure paths; keep their existing result contracts. Launcher and test wrapper are not spawned by the app. Do not disable independently configured remote Mneme MCP servers.

  ```ts
  // Before: startMneme proceeds directly to sidecar.start(...).
  // After: const availability = getPlatformFeature("memory.mnemeSidecar");
  //        if (!availability.available) return a non-running status with availability.reason.
  ```

  Defer runtime feature-table overrides: static Linux gates plus main-process guards and existing spawn-failure results meet this startup scope. On Windows a missing helper remains visible in the static feature table and reports failure when invoked; hiding it dynamically would require shared runtime detection and propagation, and changes existing Windows behavior. A future task may design that separately.

- [x] **Guardrails.** Use `isWindows` / `isLinux`, never add scattered `process.platform`; `eslint.config.mjs`'s `existingPlatformChecks` allowlist only shrinks. No new protocol, dynamic-import cycle workaround or zone exception. Roadmap §2.3 god files only shrink; use the named collaborator if a listed file needs new behavior. In strict folders nullability fixes change types only, never runtime conditions. `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass. No new unit tests or test harnesses.
- [ ] **Windows checks (Claude).** Run the Windows `npm run test:ui` integration suite and the focused areas `core/files`, `core/smoke`, `core/startup`, `boards/lifecycle`, `tools/clipboard`, and `tools/mneme`. These areas do not by themselves establish identity or launcher behavior. Manually launch a second Windows launcher instance with a file and verify the file opens in the running instance; also check profile handoff and board taskbar identity.

### Live check (Claude)

**Results, 2026-11-25 (WSL Ubuntu 26.04, cold start, no local F5 patch):**

- **Files:**
  - `pages.openUrl("/home/dev/us2200 test #1.txt")` opens the file.
  - `file:///home/dev/us2200%20test%20%231.txt` reaches the same page.
  - A relative path is rejected with the new "absolute local path" message.
  - Edit, save and read back from disk all match.
  - The renderer data directory is `/home/dev/.config/persephone/data`.
- **Socket:**
  - `persephone.sock` is created in `$XDG_RUNTIME_DIR` (`/run/user/1000`), and no pipe-named file appears in the working directory.
  - An `OPEN <path>` message sent over the socket opens the file.
  - After a `kill -9`, the socket file stays behind and is reclaimed at the next start; OPEN works again.
  - A SIGTERM quit removes the socket.
  - Closing the window keeps the app running in the tray (F10), so the socket stays, as expected.
- **Startup log:** no pipe, data-directory or taskbar errors.
- **Not run:**
  - a named profile;
  - `--test` probing and `--attach` on Linux;
  - a board window;
  - starting with `XDG_RUNTIME_DIR` unset;
  - the direct Mneme and snip entry points;
  - a real second-instance launch through Electron's single-instance lock (that code is unchanged).
- **Windows, 2026-11-25:**
  - typecheck and lint pass.
  - `test:ui` areas `core/files` 8/8, `core/startup` 6/6, `boards/lifecycle` 12/12, `tools/clipboard` 5/5 and `tools/mneme --with mneme` 2/2 pass.
  - `core/smoke` passed 2/2 on a re-run; the first run timed out while the test runner was setting up.
  - The full suite and a manual handoff through the packaged launcher were not run.
- **Change made after review:** `pipe-server.ts` again probes the pipe on Windows after an "address in use" error and reclaims it only if nobody answers. Codex's version had dropped that probe on Windows.

- [ ] Sync the implementation to WSL using US-2198's method, without its local F5 patch; cold start, open a POSIX file from dialog and absolute path, edit, save, reopen and verify contents. Open a `file:///home/...` URL and an archive entry, and check fragment behavior.
- [ ] Start a second instance with a file and confirm handoff, including a named profile; confirm the socket is under `XDG_RUNTIME_DIR`, no literal Windows pipe-shaped file appears in cwd, and a stale socket is reclaimed after a crash. Confirm normal shutdown cleans up. Exercise test-controller already-running detection and `--attach`; with `XDG_RUNTIME_DIR` unset confirm startup logs and probe fails clearly.
- [ ] Check default and named-profile data directories and first-paint theme, plus a board window and identity update. Exercise unavailable snip/Mneme through direct entry points and missing helper cases; the app stays usable and a remote Mneme connection remains independent.

## Decisions

1. **Unix socket on Linux.** The test controller requires profile probing for both the already-running guard and `--attach`; a Windows-only pipe would make Linux `--test` unusable. EPIC-212 decision 5 permits a Unix socket when needed; use the existing protocol and fail closed only when `XDG_RUNTIME_DIR` is unset.
2. **Defer runtime helper visibility.** EPIC-212's US-2200 scope of turning features off when the helper is missing is met on Linux by the static platform table and main-process guards. Dynamic Windows missing-helper hiding is deferred to a later phase: platform availability currently describes OS support, and errors are reported on invocation. Multiplatform roadmap section 4 decision 5's runtime-table goal remains future work; this avoids adding propagation and changing Windows behavior now.
3. **Require startup injection.** A missing renderer data-directory argument is a configuration error; the verified main renderer receives Electron's `getDataFolder()` through `OpenWindow`. This enforces EPIC-212 decision 4 rather than deriving data paths from environment variables. The separate first-paint theme script must use the same injected directory.
4. **Defer path identity and URL hardening.** Record unconditional POSIX backslash normalization for US-2201; it is not the open/save blocker. File URL hardening beyond preserving the POSIX root is also out of scope, preserving current decoding and Windows behavior.

## Acceptance Criteria

- [ ] Linux absolute paths and `file:///` URLs open, edit, save and reopen, including the existing archive and fragment behavior; Windows path, URL, archive and save behavior is preserved.
- [ ] Linux uses the per-user XDG runtime socket, reclaims stale sockets safely, cleans up on shutdown, and supports test-controller profile probing and attach; missing `XDG_RUNTIME_DIR` logs and fails probing clearly. Normal single-instance handoff and Windows launcher transport work.
- [ ] Renderer data paths and first-paint theme settings originate in Electron's `app.getPath("userData")` through the existing injection, including named profiles; missing renderer injection fails clearly.
- [ ] Profile and board taskbar APIs are called only on Windows; board icon and other identity behavior remain intact.
- [ ] Unsupported or missing bundled helpers do not crash the application; direct calls respect static platform gates and return existing failure forms. Remote Mneme remains usable independently.
- [ ] Windows typecheck, lint, integration suite and focused manual checks pass; Claude completes the live checklist. No unit tests, harnesses, new protocol, allowlist growth or application implementation in this planning task.

## Files Changed

| File | Planned change |
|------|----------------|
| `src/renderer/content/link-utils.ts` | Accept POSIX absolute paths and preserve file URL root |
| `src/renderer/api/pages/open-url-validation.ts` | Reuse path recognition |
| `src/main/pipe-server.ts`, `src/main/test-mode/profile.ts` | XDG socket lifecycle and missing-runtime-directory probe error |
| `src/renderer/core/utils/startup-data-path.ts`, `index.html` | Require and use Electron-provided data path |
| `src/main.ts`, `src/main/open-window.ts` | Guard profile and board taskbar identity inline |
| `src/main/mneme-service.ts`, `src/main/snip-service.ts`, `src/main/clip-service.ts` | Guard direct unsupported starts and missing-helper stdin failure |
| This README, `doc/active-work.md`, `doc/epics/EPIC-212.md` | Plan, dashboard and epic link |

**No changes expected:** `src/shared/platform.ts`, `src/shared/platform-features.ts`, `eslint.config.mjs`, `src/main/main-services.ts`, `src/main/main-setup.ts`, `src/main/utils.ts`, `src/renderer/core/utils/file-path.ts`, `src/renderer/core/utils/path-utils.ts`, `src/renderer/content/parsers.ts`, `src/renderer/api/pages/descriptor-migrations.ts`, `src/renderer/editors/markdown/markdown-nav.ts`, `src/main/sidecar-process.ts`, `src/main/clipboard-service.ts`, `src/main/native-dialog-tracker.ts`, `src/main/windows-sso.ts`, `launcher/`, `snip-tool/`, `mneme/`, and existing integration tests. Revisit only if implementation exposes a specific missed dependency; do not add platform ports or runtime override infrastructure here.
