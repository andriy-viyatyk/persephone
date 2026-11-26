# US-2216: Default browser and board shortcuts

**Epic:** [EPIC-214](../../epics/EPIC-214.md) · **Status:** Planned

## Goal

Provide Linux default-browser registration and board launchers while preserving Windows behavior and the user's browser choice.

## Background

- `src/main/browser-registration.ts` registers Windows HTTP and HTTPS schemes and `.htm` / `.html` associations in HKCU. Its status currently means registered, not selected as default; named profiles are rejected.
- `src/renderer/editors/board/board-shortcut.ts` checks `desktop.boardShortcut`, resolves board display text, asks for a `.lnk` destination and sends a rendered icon over the existing IPC. `src/main/board-window-identity.ts` validates a 256×256 PNG, wraps it in an ICO and writes and verifies a Windows shortcut.
- Both `desktop.defaultBrowser` and `desktop.boardShortcut` are currently unavailable on Linux in `src/shared/platform-features.ts`.
- `src/renderer/components/icons/board-icon-cache.ts` probes `icon.svg`, `icon.png`, then `icon.ico`. `renderBoardIconDataUrl` in `src/renderer/editors/board/board-window-icon.ts` rasterizes the selected icon (or fallback glyph) to a 256×256 PNG, so Linux can reuse it without decoding ICO in main.
- `src/renderer/api/boards.ts` resolves a trusted board before calling the shortcut core; `src/renderer/scripting/ai-vision/namespaces/boards.ts` describes this same operation to MCP. The core's Phase 0 gate already covers both script and MCP, despite the older R-3 inventory description. The three UI menus also use the feature gate.
- `scripts/dev.mjs` launches `electron .` and compiles `MAIN_WINDOW_VITE_DEV_SERVER_URL` into the main bundle; `src/main/open-window.ts` loads that URL. A dev launcher works while `npm start` runs: a second invocation hands its arguments to the running instance through the single-instance lock for the same profile (`src/main.ts`, `src/main/main-setup.ts`; US-2214). A standalone dev launch needs the compiled-in renderer server to be running. `src/main/utils.ts` removes the app operand for `process.defaultApp` and parses `--board`, profiles, HTTP/HTTPS URLs and file paths. Windows dev shortcuts instead prefer an installed Windows launcher. Linux must not use that registry lookup or the Windows launcher.
- `package.json` sets `desktopName` to `com.viyatyk.persephone.desktop`; `scripts/linux-vm/com.viyatyk.persephone.desktop` supplies the VM development launcher. A separate hidden handler entry avoids overwriting it or adding another app-grid entry.
- `DefaultBrowserSection.ts` currently shows Windows Default Apps, and `isRegisteredAsDefaultBrowser` checks registration rather than the selected browser. `settings-catalog.ts` also describes Windows. The existing IPC in `src/ipc/contracts/app.ts` and `src/ipc/main/app-handlers.ts` can carry the existing operations.

## Implementation Plan

- [x] **Desktop entry primitives and invocation:** add `src/main/linux-desktop-entry.ts` as the owner of Linux desktop-entry value serialization and launch argv, shared by the two Linux collaborators. Use `app.getPath("exe")` and `app.isPackaged`: dev argv starts with the absolute Electron binary and absolute `app.getAppPath()` (the `.` operand), then feature arguments; packaged argv starts with the packaged executable alone, then feature arguments. Never persist a relative `.` or the current working directory. Encode each fixed argv element according to the Desktop Entry Specification's Exec quoting and two-stage backslash rules; double literal `%` to `%%`, escape quotes, backslashes, dollar signs and backticks inside quoted arguments, and keep intended field code `%u` unquoted and separate. Encode non-Exec string values separately; reject newlines/control characters where they cannot be represented safely. Do not use shell quoting, shell interpolation, or a command string assembled from raw paths. Reuse `src/main/utils.ts` launch parsing and `applicationProfileName` / `applicationProfileDirectory` from `src/main/application-profile.ts`; pass profile name and directory as separate argv values. Use the dev handoff and renderer-server behavior described in Background; Phase 4 owns packaging, but packaged entries must not contain Electron's app operand.
- [x] **Browser:** retain `src/main/browser-registration.ts` as dispatch owner and add `src/main/linux-browser-registration.ts` beside it. Select with `isLinux` / `isWindows` from `src/shared/platform.ts`, leaving Windows registry code and named-profile rejection intact. On explicit registration only, create the user applications directory under absolute `$XDG_DATA_HOME` or `~/.local/share`, write a separate `com.viyatyk.persephone-url-handler.desktop` with `Type=Application`, `NoDisplay=true`, a name, `Exec` ending in `%u`, and `MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;`. `linux-browser-registration.ts` owns the handler ID constant; never overwrite the main application entry; Windows registers no other schemes. Advertise HTML as Windows does; set `text/html` explicitly together with the two scheme MIME handlers on user request. Use `findLinuxExecutable` from `src/main/linux-executable-lookup.ts` and `execFile`/argument arrays for `xdg-settings set default-web-browser com.viyatyk.persephone-url-handler.desktop` and `xdg-mime default com.viyatyk.persephone-url-handler.desktop` for each MIME type. Report missing commands, failed writes and nonzero exits through the existing IPC error path; do not claim success after partial failure. Query `xdg-settings get default-web-browser` and `xdg-settings check default-web-browser com.viyatyk.persephone-url-handler.desktop` for Linux selected status, rather than treating a desktop file as proof of selection. Never set associations from startup or status checks.
- [x] **Browser removal and presentation:** In `src/main/linux-browser-registration.ts`, unregister deletes only the handler desktop file, then makes a small line-based edit of `$XDG_CONFIG_HOME/mimeapps.list` (default `~/.config/mimeapps.list`): in `[Default Applications]` and `[Added Associations]`, remove only values exactly equal to the handler ID; within a semicolon-separated value list drop only that ID, removing the entry if no values remain. Leave every other line byte-identical, preserving other handlers and a later browser choice; never set a replacement. If `update-desktop-database` exists on PATH, run it for the user applications directory (`~/.local/share/applications` by default, or `$XDG_DATA_HOME/applications`); its absence is acceptable. Do not attempt an `xdg-mime` removal command. Surface failures rather than clearing unrelated defaults. The Linux status says selected/not selected, and the explicit set action remains available after another browser is chosen; offer removal when selected. Hide the Windows settings button on Linux rather than running `ms-settings:`. Update `src/renderer/editors/settings/sections/DefaultBrowserSection.ts`, `src/renderer/editors/settings/settings-catalog.ts`, and `src/shared/i18n/en/settings.ts` with Linux-specific descriptions and labels while preserving Windows strings and behavior. Gate unavailable platforms using `getPlatformFeature("desktop.defaultBrowser")`, including the section/catalog and agent-facing description; named profiles retain the existing explanation. Handle command errors in the section with the existing user-visible notification/error conventions rather than leaving an unhandled promise.
- [x] **Board launcher:** `src/main/board-window-identity.ts` remains the shortcut entry point and validates shared request data; add `src/main/linux-board-shortcut.ts` beside it for Linux destination validation, PNG persistence and desktop-file writing. Dispatch through shared platform helpers; do not invoke the Windows registry, `.ico`, `shell.writeShortcutLink` or readback on Linux. Reuse the already validated 256×256 PNG from `nativeImage` and persist a `.png` under the existing userData `board-icons` directory using `boardWindowKey(BoardRoot.from(root))`; do not replace the `.ico` used by Windows window identity. Write `Type=Application`, a properly escaped `Name`, absolute `Icon`, and `Exec` containing the shared invocation, `--board`, resolved board root and optional profile arguments. Verify the written launcher and icon; honor absolute `.desktop` destination, existing-parent and `overwrite` semantics. Do not add `StartupWMClass`: the VM launcher names `com.viyatyk.persephone`, but the source inspected does not establish the Wayland app_id Electron derives from `desktopName`. Create the applications directory for the default destination; do not chmod or mark arbitrary Desktop files trusted without an explicit user action. GNOME may require its own launch permission for a Desktop copy.
- [x] **Board surface:** in `src/renderer/editors/board/board-shortcut.ts`, retain the shared availability gate and `renderBoardIconDataUrl`, but use `src/renderer/editors/board/linux-board-shortcut-options.ts` for the Save dialog's Linux `.desktop` extension, localized filter and default user applications folder. Read absolute `process.env.XDG_DATA_HOME` in the Node-enabled renderer, otherwise use `fs.commonFolder("home")` with `fpJoin` for `.local/share/applications`; create the directory through `fs.mkdir`. Explicit paths remain absolute and can target Desktop; cancellation returns null and explicit overwrite stays opt-in. Preserve the Windows `.lnk` default and dialog exactly. `src/renderer/api/boards.ts` keeps `resolveTrustedBoardRoot` and its registry checks; add no board trust or manifest rules in the Linux collaborator. Update `src/renderer/api/types/boards.d.ts` and `src/renderer/scripting/ai-vision/namespaces/boards.ts` to describe platform-appropriate extension, destination and failure semantics, retaining unavailable reasons for unsupported platforms. Add Linux-specific filter text in `src/shared/i18n/en/shell.ts`. Update the affected guidance in `assets/guides/boards/getting-started.md` and `assets/guides/agents/boards/index.md`, keeping Windows details accurate.
- [x] **Capability and boundaries:** set Linux `desktop.defaultBrowser` and `desktop.boardShortcut` available in `src/shared/platform-features.ts`; keep unsupported OS entries false and use `getPlatformFeature` for UI and MCP explanations. A missing XDG executable is a reported dependency failure, not a new OS slot. Keep all platform selection in the owning modules/collaborators and shared platform layer, with no added `process.platform` allowlist entries. Reuse existing IPC contracts and endpoint bindings; no new protocol. No new board rule outside `src/shared/board/` and the board registries. Do not grow any roadmap §2.3 god file; no dynamic import or wrapper to evade an import zone. Any `window.persephone` change requires a `BOARD_BRIDGE_VERSION` bump in `src/shared/board-bridge-version.ts` and a history line in `assets/guides/agents/boards/bridge-versions.md`; none is planned. Strict-folder null fixes are type-only unless recorded here as a behavioral change. Translate changed English messages into all built-in language packs at epic completion.
- [ ] **Verification:** run `npm run typecheck`, `npm run lint`, `npm run guides:check` and existing Windows `test:ui` areas `boards/lifecycle` and `tools/settings-page`; keep Linux CI green. Add no unit tests or test harnesses. Claude owns the live checks below.

  Implementation run: `npm run typecheck` and `npm run lint` pass. `npm run guides:check` was attempted repeatedly but esbuild fails before checking guides with `spawn EPERM`; the boards hub is 9,994 characters. Per task instructions, no unit tests, runtime checks, VM checks, or `test:ui` checks were run.

### Representative changes

```ts
// src/renderer/editors/board/board-shortcut.ts, before
filters: [{ name: t("shell.boardShortcutFileType"), extensions: ["lnk"] }],
// after: the platform collaborator supplies the existing Windows or Linux dialog options
filters: shortcutDialogOptions.filters,
```

```ts
// src/main/browser-registration.ts, before
const launcher = getLauncherPath();
// after: dispatch before the unchanged Windows body
if (isLinux) return registerLinuxDefaultBrowser();
const launcher = getLauncherPath();
```

```text
# Linux desktop entry shapes; fixed arguments must be serialized, not interpolated
Exec="/absolute/electron" "/absolute/app root" --board "/absolute/board root"
Exec="/absolute/packaged binary" %u
```

## Concerns / Open questions

- The Linux status is whether Persephone is the current browser; Windows retains its registration-only status. A choice made later by the user must never be silently reverted. An unregister operation must not damage another browser's MIME associations, including when the browser changed after registration.
- XDG desktop-file parsing and Exec parsing are different escaping layers. Literal percent signs in paths must not become field codes; MIME associations may be changed independently by desktop tools. Reject malformed output and report command failures.
- Dev launchers reference the current checkout and Electron binary; relocating the checkout invalidates them. A standalone launch needs the compiled-in renderer server, while a second invocation for the same profile hands off to the running instance as described in Background. Packaged launch uses only its executable, with packaging and uninstall integration deferred to Phase 4.
- File association defaults and GNOME trust on a Desktop copy are user-controlled. The applications-directory launcher is the reliable default; an explicit Desktop destination can require GNOME's Allow Launching action.

### Claude's VM checks (not implementation steps)

On Ubuntu 26.04 GNOME Wayland with Electron native Wayland, check EPIC-214 checklist rows 17–19: explicitly set the browser, inspect `xdg-settings get` and `check` plus HTTP/HTTPS and HTML associations, and open an external link. Choose another browser, restart Persephone, and verify that selection remains. Check removal after a changed choice preserves the other browser. Create and launch a board shortcut from the applications folder and, if chosen, Desktop; check whether GNOME groups the board window under the launcher's icon, and check SVG/ICO/PNG and fallback icons, profile arguments, paths with spaces, quotes and `%`, cancellation, overwrite and untrusted-board rejection through script and MCP. Check missing XDG utilities and write failures produce useful feedback. Compare Windows browser registration and `.lnk` behavior unchanged. Packaging is deferred; inspect the packaged argv shape separately when Phase 4 exists.

## Acceptance Criteria

- Explicit Linux browser selection creates a desktop entry for HTTP, HTTPS and HTML and uses XDG tools; status reflects current browser selection and another browser's later selection survives restart and removal.
- Linux board UI, script and MCP create usable `.desktop` launchers with PNG icons and correctly escaped absolute launch arguments, including profiles; trusted-board and overwrite rules remain intact.
- Platform feature data, unavailable explanations, user-facing wording and Windows behavior match the plan. Required verification passes; Claude performs the VM checks. Translation is deferred to epic completion.

## Files Changed

| Path | Planned change |
|---|---|
| `src/main/linux-desktop-entry.ts`, `src/main/linux-browser-registration.ts`, `src/main/linux-board-shortcut.ts` | New focused Linux serialization, browser and board collaborators |
| `src/main/browser-registration.ts`, `src/main/board-window-identity.ts` | Platform dispatch and reuse existing validation and Windows behavior |
| `src/shared/platform-features.ts` | Enable the two Linux capabilities |
| `src/renderer/editors/board/board-shortcut.ts`, `src/renderer/editors/board/linux-board-shortcut-options.ts` | Linux dialog extension and destination; preserve Windows dialog |
| `src/renderer/editors/settings/sections/DefaultBrowserSection.ts`, `src/renderer/editors/settings/settings-catalog.ts` | Linux status, actions and discovery wording |
| `src/shared/i18n/en/settings.ts`, `src/shared/i18n/en/shell.ts` | Linux-specific messages |
| `src/renderer/api/types/boards.d.ts`, `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Script and MCP contract descriptions |
| `assets/guides/boards/getting-started.md`, `assets/guides/agents/boards/index.md` | Platform-appropriate board shortcut guidance |

**No changes planned:** `src/main/linux-executable-lookup.ts`, `src/main/utils.ts`, `src/main/application-profile.ts`, `src/renderer/api/boards.ts`, `src/renderer/editors/board/board-window-icon.ts`, `src/renderer/components/icons/board-icon-cache.ts`, `src/ipc/contracts/app.ts`, `src/ipc/contracts/window.ts`, `src/ipc/main/app-handlers.ts`, `src/ipc/main/window-handlers.ts`, `src/shared/board/`, board registries, `src/shared/board-bridge-version.ts`, `integration-test/`, and `electron-builder.yml`. Existing helpers and channels are reused.

## VM results (Claude, 2026-11-26)

Ubuntu 26.04, GNOME Wayland, dev build. Checklist rows 17–19.

| Check | Result |
|-------|--------|
| Set as default browser (row 17) | **Pass after fix.** Writes `com.viyatyk.persephone-url-handler.desktop` (`NoDisplay=true`); `xdg-settings get`/`check` report it; `mimeapps.list` gets `text/html`, `x-scheme-handler/http(s)`. `gio open http://…` from another process opens the URL in a Persephone browser tab of the running app. |
| Another browser chosen later (row 18) | **Pass.** After switching http/https/html to Firefox, a Persephone restart leaves Firefox the default and the status reads "not default". Removing Persephone deletes its handler file and only its own `mimeapps.list` values; Firefox's `[Default Applications]` and `[Added Associations]` stay. |
| Board launcher (row 19) | **Pass after fix.** A board in `/home/dev/test boards/Shortcut 50% Test` gets a launcher that passes `desktop-file-validate`, with a PNG icon under `board-icons/` and `%` doubled; `gtk-launch` opens the board in its own board window from the running app. A folder without a manifest is rejected and nothing is written. The board window groups under the main Persephone dock icon. |

Fixes made during the check (Claude):

- `src/main/linux-desktop-entry.ts`: Exec arguments are quoted only when they contain a reserved character.
  `xdg-settings` takes the handler's binary from the first Exec word without unquoting it, so the quoted
  executable made `xdg-settings set default-web-browser` fail.
- `src/main/linux-board-shortcut.ts`: launchers pass `--board=<root>`, `--profile=…`, `--profile-dir=…`. Chromium
  moves switches ahead of positional arguments in the command line a running instance receives
  (`second-instance`), which separated `--board` from its root.
- `src/main/utils.ts` `launchOperands`: accepts `--board=<root>`, and under `electron <appPath>` skips the first
  positional argument (the app path) instead of the first operand, which after the reordering was the board. The
  old code also opened the app path as an empty folder page on such handoffs.
