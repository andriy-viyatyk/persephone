# US-2206: Browser file-system grants on Linux

**Epic:** [EPIC-213: Linux core parity](../../epics/EPIC-213.md) · **Inventory:** [WIN-25](../../reviews/multiplatform-2026-11/inventory.md)

## Goal

Allow browser File System Access permission requests for safe absolute Linux paths to reach the existing one-shot prompt, while protecting Linux system and private folders and preserving Windows behavior.

## Background

- `src/main/file-system-access-policy.ts` owns `fileSystemAccessToPrompt`: `DRIVE_PATH` accepts only drive-letter paths; `comparable`, `definedPaths`, `sensitiveFolders`, `isSensitive`, and `candidatePaths` use `path.win32`. Thus a POSIX request reaching this policy is rejected before classification. The original path is returned for display, with `writable` mapped to `write` and other access types to `read`.
- `src/main/permission-policy-service.ts` `requestFileSystemAccess` requires a top origin, denies an undefined policy result, otherwise uses the existing prompt with no stored permission keys. The policy rejects a different requesting origin. `doc/architecture/browser-editor.md` documents this flow. A normal single-file picker read is granted by Chromium itself and never reaches this handler; do not claim every read is denied. Directory reads, writes, restored handles and Chromium-sensitive picks can reach it.
- Current Windows rules deny drive roots; descendants, self and ancestors of `blockAll`; and home itself and its ancestors for `blockSelf`. They deny `.lnk` and `.local` files case-insensitively, but not directories based on extension. Candidate checking uses the supplied path plus `fs.realpathSync.native` of the target, or of its immediate parent for a missing target, falling back to the supplied path. Keep the existing requester, error fallback, prompt and Windows input acceptance semantics, including rejecting UNC and drive-relative paths.
- US-2205 has landed: `comparePathKey` in `src/main/utils.ts` resolves a native path, then `resolvedPathCompareKey` in `src/shared/path-containment.ts` strips trailing `/` characters. On Linux `/` therefore has the empty key; `isKeyInside("", childKey)` treats every absolute non-root key as a descendant. The Linux branch must deny a root candidate explicitly before containment and skip the root `blockSelf` entry thereafter. Use these helpers only on Linux; do not modify them here.
- The repository's `src/main/file-system-access-policy.ts` and `doc/architecture/browser-editor.md` describe a Chromium sensitive-path blocklist, but do not contain Chromium's Linux list; a targeted filename and content search of `src`, `doc`, `integration-test`, and installed `node_modules/electron` found no Chromium source list. Its exact Linux entries and match types are **not available offline**, so equivalence to Chromium cannot be claimed. The list below is this task's explicit policy, not an asserted Chromium copy.
- `integration-test/tests/browser/permissions/permissions.test.mjs` covers notification permission and prompt UI, not File System Access; searches for picker APIs and `fileSystem` under `integration-test/tests/browser` and browser HTTP fixtures found no File System Access grant test. `doc/tasks/completed.md` US-2143 records previous live sensitive-path, origin, one-shot prompt and real directory picker checks, not an automated area. Native file dialogs are not answered by the existing runner (`src/main/test-mode/downloads.ts` notes the runner cannot answer OS dialogs).

### Windows protection mapped to Linux

`blockAll` means self, descendants, and ancestors are denied; `blockSelf` means only self and ancestors are denied. These ancestor rules prevent a broad directory grant from containing a protected location. Paths are native, and only absolute configured paths are used.

| Existing Windows entry or class | Linux counterpart and rule |
| --- | --- |
| Drive root | `/` is `blockSelf`, not `blockAll`: otherwise every Linux path would be denied. |
| `app.getPath("home")` | `app.getPath("home")` is `blockSelf`; ordinary child folders can still be granted. |
| `app.getPath("appData")`, `LOCALAPPDATA`, `<home>\\AppData` | `app.getPath("appData")`, `~/.config`, and absolute `XDG_CONFIG_HOME` or its `~/.config` default are `blockAll`. Protect absolute `XDG_DATA_HOME` or `~/.local/share` default **only at its `keyrings` child**, plus `~/.local/share/keyrings`; blocking all of `.local/share` is not required by this policy. Ignore relative/empty XDG values. |
| `app.getPath("userData")` | `app.getPath("userData")` is `blockAll`, including named-profile data. |
| `path.dirname(app.getPath("exe"))` | Native executable parent is `blockAll`, even for a custom install; `/usr` and other system paths independently protect typical installs. |
| `SystemRoot`, `windir` | `/etc`, `/usr`, `/bin`, `/sbin`, `/boot`, `/dev`, `/proc`, `/sys`, `/var`, `/root`, `/run`, `/snap`, and root-level `lib` and `lib*` directories are `blockAll`. Once per process, cache `/lib`, `/lib32`, `/lib64`, `/libx32` plus literal root entries from `readdirSync("/")` matching `^lib` (including symlinked directories); if the read fails, retain the four fixed names. Do not use a string prefix match against unrelated siblings. |
| `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432` | `/usr`, `/bin`, `/sbin`, `/lib*`, `/snap` and executable parent above cover system application installations. |
| `ProgramData` | `/var`, `/etc`, `/usr` and `/snap` cover machine-wide data and configuration. |
| `<home>\\.ssh` | `~/.ssh` is `blockAll`; also protect `~/.gnupg`, `~/.mozilla`, `~/.pki`, and the keyring locations above as credential/browser stores. |
| `.lnk`, `.local` file extensions | Retain the existing extension check unchanged on all platforms; it is an extension rule, not a directory equivalent. |

`~` means the Electron home path, joined using native `path`; it is not shell expansion. Protecting an XDG location outside home also denies its ancestors, including the containing mount path, by the existing policy. Root and home must not be added to `blockAll` merely because they contain sensitive paths.

## Implementation Plan

- [x] Keep the existing Windows `comparable`, `isInside`, and `path.win32` comparison logic exactly as it is, including folder construction, validation, extension handling and candidate realpath fallback. If extracting it to `src/main/file-system-access-policy-windows.ts`, move that logic unchanged; otherwise leave it untouched. In `src/main/file-system-access-policy-linux.ts`, own the Linux folder list and classification. Select with `isWindows` and `isLinux` from `src/shared/platform.ts`; deny unsupported platforms. Keep the original request path in prompt data, and preserve origin and error behavior.
- [x] On Linux require `path.isAbsolute(filePath)` and use native `node:path` operations and absolute configured paths. Use `comparePathKey` and `isKeyInside(parentKey, childKey)` only in the Linux branch. Deny a candidate whose key is empty (`/`) before containment; skip the empty root `blockSelf` key after that check, so root does not block all children. For non-root `blockAll` folders reject equality or containment in either direction; for non-root `blockSelf` folders reject equality or a candidate ancestor only. `isKeyInside` includes equality and uses segment boundaries, so `/etc2` is not `/etc`.
- [x] Cache root-level `lib*` enumeration once per process: combine the four fixed names with `readdirSync("/")` entries matching `^lib`; catch read failures and use the fixed names. Treat entries as literal paths, not prefixes.
- [x] Keep both supplied and realpath-resolved candidate checks. On Linux use native `path` for the immediate-parent fallback for a not-yet-created file; leave the Windows fallback unchanged. On Linux also compare each protected folder's lexical and realpath-resolved identity, where it exists, so `/bin` → `/usr/bin`, aliases to private folders, symlinked home/config, and resolved candidate paths cannot bypass the list. Preserve lexical entries when realpath fails and do not canonicalize Windows protected-folder entries differently. Retain the current fallback if target and immediate parent cannot be resolved; do not claim it resolves arbitrary nonexistent ancestor chains or prevents later symlink races.
- [x] Use native case-sensitive keys and literal backslashes on Linux; do not lowercase or treat `\\` as a POSIX separator. Keep `.lnk`/`.local` extension matching and same-origin behavior exactly as before. Check that normal home children outside protected entries remain promptable, and that `blockAll` ancestors, symlink aliases, and protected descendants deny without a prompt. Directory and writable requests must follow the same classification.
- [x] Run `npm run typecheck` and `npm run lint`.
- [ ] Claude runs `npm run test:ui -- --area browser/permissions` on Windows and Linux (Linux setup: `doc/standards/integration-tests.md`). This area covers neighboring permission UI, not the file-grant policy.
- [ ] Claude performs a Linux live policy check in the running app's main process: invoke the implemented `fileSystemAccessToPrompt` itself with matching requesting and top origins and writable requests, using `main.script.execute` over MCP when enabled. If unavailable, enable main-process scripting in Settings > MCP Server and use MCP; if MCP itself is unavailable, use the existing test runner's `ctx.app.main.script.execute` on a running development app. Load the actual built policy module in that process; if bundling prevents importing it, use a main-process debugger to invoke the actual function. Record the returned prompt or `undefined`, not a reimplementation of the rules. Use a normal Linux test profile with home and temporary fixtures outside all configured protected paths and executable parent, with no unusual XDG overrides; create and clean up only disposable fixtures. Use directories where indicated, files otherwise, and a same-origin request throughout. `Prompt` means a prompt result, `Deny` means `undefined`.

  | Path | Expected decision |
  | --- | --- |
  | `/` (directory) | Deny |
  | Electron home (directory) | Deny |
  | A disposable ordinary child of home (directory) | Prompt |
  | `~/.ssh` (directory) | Deny |
  | `~/.config/x` (directory) | Deny |
  | Electron `userData` (directory) | Deny |
  | `/etc/passwd` (file) | Deny |
  | `/usr/bin` (directory) | Deny |
  | Symlink in a disposable temp folder pointing to `~/.ssh` (directory; ensure target exists) | Deny |
  | Missing file under an existing ordinary disposable folder | Prompt |
  | Relative path `relative-file` (file) | Deny |
  | File named `literal\name` in an ordinary disposable folder (one literal backslash) | Prompt |

  Resolve `~` using Electron home; create `~/.ssh` only in an isolated disposable test profile if needed. Record deviations caused by environment or fixture setup rather than changing expected decisions. No unit tests or new harnesses are required.

### Live policy check (Claude, 2026-11-26)

WSL Ubuntu 26.04.1, dev build. `src/main/file-system-access-policy.ts` was bundled on its own with esbuild
(`--platform=node --external:electron`) and loaded in the running app's main process through
`main.script.execute`, so the real code ran with Electron's real `app.getPath` values. Writable requests, same
origin. All 12 rows of the table above returned the expected decision: Deny for `/`, home, `~/.ssh`,
`~/.config/x`, `userData` (`~/.config/persephone`), `/etc/passwd`, `/usr/bin`, a temp symlink to `~/.ssh` and a
relative path; Prompt for an ordinary home child, a missing file in an ordinary folder, and a file named
`literal\name`.

## Concerns

- Exact Chromium Linux blocklist parity is unverified offline; when its matching source for the shipped Electron/Chromium becomes available, compare entries **and** whether each blocks self, descendants, or ancestors. Do not claim parity from the repository's generic description. This does not block implementing the explicitly specified list.
- The Linux empty-root-key special case is security-sensitive; never send it through ordinary containment as a `blockSelf` folder. Windows retains its existing comparison logic exactly, including drive-root, case and separator behavior.
- Canonicalization is best effort and subject to filesystem races; current missing-target handling resolves only its immediate parent. Preserve this scope rather than promising race-free enforcement. Cached root-level `lib*` enumeration must tolerate a failed read and still include the four explicit fallback names.
- Linux `appData`/XDG overrides and an executable in a user directory can cause an otherwise ordinary ancestor to be rejected. This follows the existing ancestor protection and executable-folder policy. Only absolute XDG values count; do not resolve a relative environment value against the working directory.
- Native GTK picker end-to-end verification remains a Phase 2 VM check: the runner and Claude cannot reliably drive native dialogs.
- macOS is not covered by the Linux list; deny unsupported policy selection pending a separately designed platform collaborator. Do not imply a tested macOS policy.

## No changes

- `src/shared/path-containment.ts` and `src/main/utils.ts`: consume their US-2205 APIs and contracts; their implementation belongs to US-2205.
- `src/shared/platform.ts`: use existing flags. `src/main/permission-policy-service.ts`, `src/ipc/browser-ipc.ts`, browser renderer prompt views and `src/main/site-permission-store.ts`: reuse the existing one-shot permission flow and IPC.
- `integration-test/tests/browser/permissions/permissions.test.mjs` and browser fixtures: run existing coverage; native picker end-to-end coverage is deferred to Phase 2 VM verification. No new unit tests or harnesses.
- `doc/active-work.md` and `doc/epics/EPIC-213.md`: user explicitly excluded edits. Developer and user guide completion work is deferred to the epic's completion workflow.

## Acceptance Criteria

- [ ] Safe absolute Linux directory/read-upgrade and write requests reach the existing prompt; invalid/relative paths and sensitive paths are denied. Single-file reads handled entirely by Chromium are described accurately.
- [ ] The Linux table, ancestor and descendant rules, XDG fallback/absolute checks, realpath aliases, missing immediate-parent fallback, root, case and POSIX backslash semantics are implemented as specified; original paths remain in prompt data.
- [ ] Windows path acceptance, extension, folder, origin, link fallback and prompt decisions remain byte-identical. Windows `comparable`, `isInside` and `path.win32` comparison logic remain exactly unchanged; platform flags and Linux-only shared comparison/containment helpers are reused without modifying the shared helper or adding `process.platform` checks.
- [ ] Typecheck and lint pass; Claude records the named Windows and Linux UI area and the fixed Linux main-process policy checks and results. No unit tests or harnesses are added.

## Files Changed Summary

| Path | Planned change |
| --- | --- |
| `src/main/file-system-access-policy.ts` | Platform selection and Linux policy integration; preserve prompt and existing Windows logic exactly. |
| `src/main/file-system-access-policy-windows.ts` | Optional extraction of existing Windows logic unchanged. |
| `src/main/file-system-access-policy-linux.ts` | Own Linux classification and cached system, XDG, home and application sensitive-folder list. |
| Files listed under No changes | Reuse existing platform, containment, permission and UI contracts; leave dashboard and epic untouched. |
