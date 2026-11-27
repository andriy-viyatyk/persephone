# US-2234: Linux package targets

[EPIC-216](../../epics/EPIC-216.md) · Planned

## Goal

Build x64 Debian and AppImage packages on Linux with the native helpers and desktop integration required by Persephone, while preserving Windows packaging. This is a packaging task, not a Linux release.

## Background

- `electron-builder.yml` currently includes common app files and resources, excludes all koffi builds except `win32_x64`, unpacks that binary, and copies `build/README.txt` and four `.exe` files to the executable directory. `extraResources` puts `assets` and the three Vite host bundles under `resources/assets`. `asar`, fuses, Castlabs download, `afterSign: scripts/vmp-sign.mjs`, `win`, `nsis`, and GitHub draft `publish` settings remain intact. `package.json` defines `desktopName: com.viyatyk.persephone.desktop`; `dist`, `dist:zip`, and `dist:publish` target Windows.
- `src/main/mneme-service.ts` `getMnemeExePath()` and `src/main/snip-service.ts` `getSnipToolPath()` use the release Cargo directories in development, and `path.dirname(process.execPath)` in packaged builds. Both reuse `helperExecutableName()` in `src/shared/platform.ts` (adds `.exe` on Windows). Linux helpers therefore belong beside `persephone`, including inside the AppImage's mounted application directory, not under `resources`. `src/main/utils.ts` `getAssetPath()` uses `process.resourcesPath/assets` for unrelated assets. `src/main/browser-registration.ts` `getLauncherPath()` uses `app.getPath("exe")` for the Windows launcher and fallback; Linux browser registration instead uses `linuxDesktopInvocation()` in `src/main/linux-desktop-entry.ts`. The Windows launcher and test wrapper have no Linux package equivalent.
- `src/main/virtual-desktop-manager.ts` uses koffi for Windows COM. Nevertheless EPIC-216 requires the Linux native module. `node_modules/koffi/index.js` detects `linux_x64` and loads `build/koffi/linux_x64/koffi.node` (with musl fallback); the installed 2.16.3 distribution contains that directory. Keep only the matching native build and unpack it from asar on each platform.
- The dev entry `scripts/linux-vm/com.viyatyk.persephone.desktop` uses `StartupWMClass=com.viyatyk.persephone`, `Development;TextEditor;`, and `assets/icon.png`. The PNG is 256×256; `assets/icon.ico` contains 16, 32, 48, 64, 128 and 256 pixel images and remains the Windows icon. `build/README.txt` explicitly describes Windows, uses backslashes and `%APPDATA%`; ship it unchanged on Windows only. `build/installer.nsh` is Windows-only.
- `src/main/linux-browser-registration.ts` creates its own `com.viyatyk.persephone-url-handler.desktop` for HTTP, HTTPS and HTML. The package entry must not claim URL schemes or override that handler. `src/main/launch-inputs.ts` invokes `launchOperands()` and `parseLaunchArguments()` in `src/main/utils.ts` on cold start; `src/main/main-setup.ts` routes `second-instance` through `src/main/open-windows.ts` to the same parser with the sender's working directory. It accepts paths, folders and HTTP(S), but does not convert `file://` URLs. `%U` can pass file URLs, so conversion is required; `%F` alone cannot fix AppImage because this builder hardcodes `%U`.
- Installed `app-builder-lib` is 26.18.0. Its `scheme.json` explicitly permits `files`, `extraFiles`, and `asarUnpack` in both `WindowsConfiguration` and `LinuxConfiguration`. `out/fileMatcher.js` combines root patterns followed by platform patterns, so remove the root koffi platform exclusion and root unpack list before adding the per-platform rules. Schema validation accepts `desktop.entry` as an object despite its generated `typeof` representation. `out/targets/LinuxTargetHelper.js` needs `syncDesktopName: true` to use the package desktop name and builds desktop values from `desktop.entry`, `mimeTypes`, `category` and executable options. `out/targets/appimage/AppImageTarget.js` unconditionally adds `%U` and, for its default legacy toolset, defaults to `--no-sandbox` unless `executableArgs` is explicitly set. `out/targets/FpmTarget.js` uses bundled default Debian hooks and its default dependency list; overriding `depends` replaces that list.
- `doc/linux-development.md` documents the two release Cargo builds and development libraries. `.github/workflows/linux-ci.yml` installs Linux libraries and build tools, runs `npm ci` and explicitly downloads Electron; it does **not** build the Rust crates. Do not assume that CI already creates the helpers.

## Implementation Plan

1. [x] **Own packaging rules in `electron-builder.yml`.** Keep all existing common `files` entries except the koffi platform exclusion; keep the common koffi source/vendor/doc exclusion and all other filters. Remove root `extraFiles` and `asarUnpack`; move the exact existing README and four `.exe` mappings to `win.extraFiles`, existing koffi exclusion to `win.files`, and existing native unpack entry to `win.asarUnpack`. Add the Linux counterparts. Preserve existing ordering and mappings; common patterns and platform patterns are combined by the existing builder matcher, not a new script. Representative before → after:

   ```yaml
   # Before (root)
   files:
     # ...common patterns...
     - "!node_modules/koffi/build/koffi/!(win32_x64)/**"
   extraFiles: # README.txt and four .exe mappings
   asarUnpack:
     - node_modules/koffi/build/koffi/win32_x64/koffi.node

   # After (retain the other root files and extraResources unchanged)
   win:
     files:
       - "!node_modules/koffi/build/koffi/!(win32_x64)/**"
     asarUnpack:
       - node_modules/koffi/build/koffi/win32_x64/koffi.node
     extraFiles:
       - from: build/README.txt
         to: README.txt
       - from: launcher/target/release/persephone-launcher.exe
         to: persephone-launcher.exe
       - from: launcher/target/release/persephone-test.exe
         to: persephone-test.exe
       - from: snip-tool/target/release/persephone-snip.exe
         to: persephone-snip.exe
       - from: mneme/target/release/mneme.exe
         to: mneme.exe
     # retain existing icon and targets
   linux:
     files:
       - "!node_modules/koffi/build/koffi/!(linux_x64)/**"
     asarUnpack:
       - node_modules/koffi/build/koffi/linux_x64/koffi.node
     extraFiles:
       - from: mneme/target/release/mneme
         to: mneme
       - from: snip-tool/target/release/persephone-snip
         to: persephone-snip
   ```

   The builder warns and continues for missing `extraFiles` sources (`out/fileMatcher.js` `copyFiles`); explicitly check both executable files exist and are executable before packaging, and assert they exist in output. Do not silently ship missing helpers.

2. [x] **Configure Linux targets and desktop metadata in `electron-builder.yml`.** Add these properties to the above `linux` mapping and target-specific sections:

   ```yaml
   linux:
     # include files, asarUnpack and extraFiles from step 1
     target:
       - target: deb
         arch: [x64]
       - target: AppImage
         arch: [x64]
     executableName: persephone
     syncDesktopName: true
     icon: assets/icon.png
     category: Development;TextEditor
     synopsis: Developer notepad and data tools
     description: Tabbed developer notepad with code editing, data tools, scripting and a built-in browser.
     executableArgs: []
     desktop:
       entry:
         StartupWMClass: com.viyatyk.persephone
     mimeTypes:
       - text/plain
       - inode/directory
   deb:
     artifactName: "persephone-${version}-linux-${arch}.${ext}"
     depends:
       - libgtk-3-0t64 | libgtk-3-0
       - libnotify4
       - libnss3
       - libxss1
       - libxtst6
       - xdg-utils
       - libatspi2.0-0t64 | libatspi2.0-0
       - libuuid1
       - libsecret-1-0
       - libasound2t64 | libasound2
       - libgbm1
       - libcups2t64 | libcups2
       - libdrm2
   appImage:
     artifactName: "persephone-${version}-linux-${arch}.${ext}"
   ```

   `executableArgs: []` is deliberate: it prevents the legacy AppImage default `--no-sandbox` without adding an argument; never disable the sandbox. Debian's generated `Exec` is `/opt/persephone/persephone %U`; AppImage uses `AppRun %U`. Explicitly inspect both entries, because AppImage ignores desktop `Exec` overrides and always appends `%U`. `syncDesktopName` matches Electron's app ID and dev class; the explicit `StartupWMClass` documents the contract. `category` produces `Development;TextEditor;`. The package advertises generic text and directory Open With only, no extension registrations or URL schemes. `linux.icon` lets the builder create its icon set from the existing 256px PNG; inspect generated hicolor sizes and AppImage icon, and add derived PNG sizes from that source only if the builder fails to produce them. Artifact names distinguish Linux and x64 for later US-2237 asset selection; `${ext}` yields `deb` or `AppImage`.

   The dependency list retains the nine 26.18.0 defaults, with `t64 | old` alternatives for renamed packages, and adds the runtime libraries called out in the development guide. It is a starting explicit list: the `dpkg-shlibdeps` audit in step 5 is the authority for finalizing package names and version constraints. Keep `xdg-utils` for browser/desktop helpers. Do not add development tools as runtime dependencies.

3. [x] **Own operand-to-local-path conversion in `src/main/launch-operand.ts`.** Add a small platform-neutral main-process helper using Node's existing `fileURLToPath` from `node:url`. Convert valid local `file:` URLs, return ordinary path operands unchanged, and reject malformed or nonlocal file URLs rather than treating them as paths. A `file:` operand is not a valid ordinary Windows path either, so no platform switch is needed. Call the helper in `src/main/utils.ts` `parseLaunchArguments()` only in the file/folder branch before `path.resolve`. Preserve HTTP(S), `diff`, `--board`, argv ordering, relative cwd and ordinary Windows paths. Reuse `launchOperands`, `parseLaunchArguments`, `isValidOpenPath` and `parseLaunchInputs`; do not create a second handoff protocol. Claude verifies live handoff in the VM under Acceptance Criteria. Representative before and after:

   ```ts
   // Before, inside parseLaunchArguments
   const resolvedPath = path.resolve(cwd, operand);
   // After: normalize file URLs; ordinary paths pass through unchanged.
   const pathOperand = launchOperandToLocalPath(operand);
   if (pathOperand === undefined) continue;
   const resolvedPath = path.resolve(cwd, pathOperand);
   ```

4. [x] **Build entry point and documentation.** In `package.json`, add `"dist:linux": "node scripts/build-prod.mjs && electron-builder --linux --x64"`, leaving every Windows script unchanged. In `doc/linux-development.md`, replace the statements that Linux packaging is deferred with a packaging section: use a separate Linux filesystem checkout in WSL or the VM; `npm ci`, `node node_modules/electron/install.js`, both existing `cargo build --release --manifest-path ...` commands, check both executable outputs, then `npm run dist:linux`; artifacts are in `release/`. Set `VMP_SIGN` unset/false: the current `scripts/vmp-sign.mjs` skips signing only in that case; its Linux-safe unconditional skip belongs to US-2236. Explain the runtime packages, dependency check below, cache/network requirements and sandbox work owned by US-2235. Windows release instructions in `doc/standards/release-process.md` do not change.

5. [ ] **Inspect packages and dependency closure on Linux without running the app.** First test `wsl -e true` from the Codex sandbox. If it works, build both formats in Ubuntu 26.04.1 LTS WSL using a Linux-filesystem copy (not `/mnt/c`), with the prescribed Rust and Electron prerequisites; WSL has `dpkg-shlibdeps`. If it fails, record the exact failure and stop after the configuration and documentation changes; Claude runs this build and audit. Check `.deb` with `dpkg-deb -c` and `dpkg-deb -f <deb> Depends`; extract it with `dpkg-deb -x <deb> <staging>` and control scripts with `dpkg-deb -e <deb> <control-dir>`. Inspect desktop metadata, icon sizes, executable permissions, helper adjacency, unpacked koffi and absence of Windows-only root files; inspect AppImage without launching the app using an appropriate extraction tool and compare its equivalent files and entry. Ensure `--no-sandbox` is absent. Validate both entries with `desktop-file-validate`.

   For a reproducible `dpkg-shlibdeps` audit, in a temporary working directory create a minimal `debian/control` source/binary stanza for `persephone`, unpack the deb, and run `dpkg-shlibdeps -O` with `-e` for each packaged ELF: `/opt/persephone/persephone`, `mneme`, `persephone-snip`, `chrome-sandbox`, all packaged Electron `.so` files and `resources/app.asar.unpacked/node_modules/koffi/build/koffi/linux_x64/koffi.node`. Point `LD_LIBRARY_PATH` at the extracted `/opt/persephone` for bundled libraries and run on a matching distribution with `dpkg-dev` and relevant `-dev`/runtime package metadata installed. Enumerate ELF files with `find` and `file`, not a guessed fixed list; do not pass data or symlinks twice. Compare the generated `shlibs:Depends` including version constraints against `dpkg-deb -f <deb> Depends`; bundled libraries must resolve locally, and every external SONAME/version must be covered. Investigate unresolved libraries rather than suppressing them. Use the Ubuntu 26.04 audit to finalize `deb.depends`, then rebuild and recheck. Claude checks dependency resolution on the clean Debian 13 VM with `apt install ./<deb>` under Acceptance Criteria. This is a static build/dependency check, not a VM install/run step.

6. [ ] **Prove the Windows set is unchanged.** Before any edit to `electron-builder.yml`, build a baseline from the same Windows checkout, version, dependencies and built Rust helpers with `npx electron-builder --win --dir` (after the same `npm run build-prod`); save sorted relative file paths outside `release/win-unpacked`, and an asar listing (`npx asar list release/win-unpacked/resources/app.asar`), including `app.asar.unpacked`. Repeat after the change and diff both lists. Before and after, the added installation-root set is `README.txt`, `persephone-launcher.exe`, `persephone-test.exe`, `persephone-snip.exe`, `mneme.exe`; common assets and three host bundles remain in `resources/assets`, only koffi `win32_x64` remains and its `.node` is unpacked. Compare asar membership as well as unpacked paths, because the directory listing alone hides asar content. Run `npm run dist` once after the change and check the NSIS and ZIP asset names. Use identical signing environment, normally `VMP_SIGN` unset. If electron-builder cannot run in the sandbox (for example EPERM), or prerequisites or network access prevent the comparison, record the exact failure; Claude runs the comparison before acceptance.

## Implementation results

- `npm run typecheck`, `npm run lint` and the final `npm run build-prod` passed. The first build-prod attempt hit the sandbox's esbuild `spawn EPERM`; a later run completed successfully.
- Step 5 remains incomplete. `wsl -e true` failed with `Access is denied. Error code: Wsl/Service/CreateInstance/E_ACCESSDENIED`; per the plan, the Linux package build, package inspection and `dpkg-shlibdeps` audit were not run. Claude must run them.
- Step 6 remains incomplete. Before editing `electron-builder.yml`, `npm run build-prod` failed in the renderer with `Error: spawn EPERM` from esbuild `ensureServiceIsRunning` (`scripts/build-prod.mjs:235`, Node.js v24.18.0). The required pre-edit `npx electron-builder --win --dir` then failed with `spawn EPERM` while electron-builder forked `@electron/rebuild` (`app-builder-lib/src/util/rebuild.ts:10`). No baseline path list or asar listing was produced, so there is no valid before/after diff. After the change, `npx electron-builder --win --dir` and `npm run dist` also failed with `spawn EPERM` while forking `@electron/rebuild`; NSIS/ZIP asset names were not produced or checked. Claude must run the Windows comparison before acceptance.

## Concerns

- **Builder-owned hooks already exist.** `node_modules/app-builder-lib/templates/linux/after-install.tpl` sets the sandbox mode, updates desktop databases, and conditionally installs an AppArmor profile; `after-remove.tpl` removes the alternative and profile. `FpmTarget.js` supplies these even when `deb.afterInstall`/`afterRemove` are absent. Do not add or replace hooks in this task. US-2235 owns measurement and any custom `deb.afterInstall` / `deb.afterRemove` extension; it must preserve the builder's integration behavior when replacing templates. Inspect generated control scripts so this existing behavior is visible to Claude.
- **Network/offline:** `out/toolsets/linux.js` `getFpmPath()` normally downloads and caches `fpm-1.17.0-ruby-3.4.3-linux-amd64.7z` for a Linux x64 `.deb`; it does not need a download on every build if cached. Offline builds need the pre-populated builder cache or a compatible installed fpm selected with `USE_SYSTEM_FPM=true` / `CUSTOM_FPM_PATH`; Electron, AppImage tools and other build inputs also need caches. Do not promise a clean offline build. Linux targets build reliably on Linux, not the Windows checkout.
- **Sandbox and signing:** the builder's default AppImage `--no-sandbox` must be suppressed as above; actual sandbox/AppArmor behavior remains US-2235, and Linux signing hook behavior US-2236. No user-facing release until the epic exit checks.
- **Development CI is not release CI:** `.github/workflows/linux-ci.yml` builds no Rust crates; US-2238 owns release workflow changes. Dependency closure must be checked against actual built binaries, including Rust/ONNX, and verified on both target distributions.

## Acceptance Criteria

- [x] Linux x64 `.deb` and AppImage build in Linux with the names above; static inspection shows correctly placed executable helpers, only Linux x64 koffi, resources, correct desktop entry and icon, and no Windows-only root binaries or README.
- [x] Desktop metadata advertises only `text/plain` and `inode/directory`, without URL schemes; the browser handler remains independent.
- [x] Static `dpkg-shlibdeps` comparison covers all packaged ELF binaries and native libraries against Ubuntu 26.04 metadata; resulting `Depends` covers the external dependencies and constraints. Generated hooks and no-sandbox absence are inspected.
- [x] Windows before/after directory and asar membership diff is empty, and the post-change Windows NSIS and ZIP asset names are checked; `dist`, `dist:zip`, and `dist:publish` retain their commands and settings.
- [x] `doc/linux-development.md` explains reproducible build prerequisites, dependency audit and offline limits; Windows release instructions remain unchanged.
- [ ] **Claude VM check:** on clean Debian 13, `apt install ./<deb>` resolves every dependency name and version.
- [ ] **Claude VM check:** on clean Ubuntu 26.04 and Debian 13 separately, install and run each format; check dock identity/icon, file and folder handoff for cold and running app including `%U` file URLs, multiple files and paths with spaces, invalid/nonlocal file URLs, normal paths and HTTP(S), terminal launch, browser registration, snip and Mneme, and uninstall. Sandbox verification and fixes are owned by US-2235; never use `--no-sandbox`.

## Files Changed

| File | Planned change |
|---|---|
| `electron-builder.yml` | Platform-specific payloads, Linux targets, metadata and dependencies |
| `package.json` | Add `dist:linux` only |
| `src/main/launch-operand.ts` | Platform-neutral operand-to-local-path helper |
| `src/main/utils.ts` | Reuse helper in shared launch parser |
| `doc/linux-development.md` | Linux build, inspection and dependency audit |

No changes: `build/README.txt`, `build/installer.nsh`, `assets/icon.png`, `assets/icon.ico`, `scripts/vmp-sign.mjs`, `.github/workflows/linux-ci.yml`, `src/main/linux-browser-registration.ts`, `integration-test/tests/core/startup/startup.test.mjs`, `scripts/linux-vm/com.viyatyk.persephone.desktop`, `doc/standards/release-process.md`, epic and dashboard. US-2235, US-2236 and US-2238 own subsequent sandbox, signing and release CI work respectively.

## Verification and corrections (Claude, 2026-11-27)

Codex's sandbox could not start WSL or electron-builder (`spawn EPERM`), so Claude ran the builds.

- **Fixed: platform-level `files` packed the whole repository.** With `win.files`/`linux.files` holding only a
  negation, electron-builder adds its default `**/*`, and the asar held every repo file (a 599 MB AppImage). The
  koffi rule is back at the top level as `!node_modules/koffi/build/koffi/!(${platform}_${arch})/**`, and
  `asarUnpack` as `node_modules/koffi/build/koffi/${platform}_${arch}/koffi.node`.
- **Windows unchanged:** `electron-builder --win --dir` with the HEAD config and with the new config give identical
  file lists (675 files) and identical asar listings (43,493 entries).
- **Added:** `homepage` in `package.json` (fpm refuses to build a `.deb` without it); `Name: Persephone` in the
  desktop entry (the default was the lowercase `productName`).
- **Artifact names:** `${arch}` is `amd64` for the `.deb` and `x86_64` for the AppImage:
  `persephone-5.0.23-linux-amd64.deb`, `persephone-5.0.23-linux-x86_64.AppImage`. Both match US-2237's patterns.
- **`dpkg-shlibdeps` audit** (9 ELF files, Ubuntu 26.04): `deb.depends` now lists every reported library.
  `mneme` needs `GLIBC_2.43` (`libm` symbols) when built on Ubuntu 26.04, so it cannot run on Debian 13 (2.41):
  release packages must be built on Ubuntu 24.04 (US-2238).
- **Package contents:** helpers beside `/opt/persephone/persephone`, only `linux_x64` koffi, desktop entry valid
  (`desktop-file-validate`), `Exec=/opt/persephone/persephone %U`, `StartupWMClass=com.viyatyk.persephone`,
  `MimeType=text/plain;inode/directory;`, 256 px hicolor icon, no Windows files.
- **Clean Ubuntu 26.04 VM:** `apt-get install ./…deb` succeeds; the app starts with the dock icon grouped; a
  `file://` operand with spaces opens on cold start, and a second launch hands its file to the running app. The
  sandbox result is in [US-2235](../US-2235-sandbox-apparmor/README.md).
- **Keyring prompt:** on first start GNOME asks to create a "Default Keyring" because the VM logs in automatically,
  so no login keyring is unlocked. Chromium-based apps behave the same; with a password login the keyring
  opens with the session. Documented for users in US-2239.
