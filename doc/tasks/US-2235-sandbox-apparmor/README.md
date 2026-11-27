# US-2235: Sandbox and AppArmor

[EPIC-216](../../epics/EPIC-216.md) · Done · **Decision (user, 2026-11-27): option A, `.deb` only**

## Goal

Both Linux packages start with Chromium's sandbox on Ubuntu 26.04 and Debian 13, with no `--no-sandbox` (epic
decision 4, inventory WIN-37).

## Measurements (2026-11-27, clean Ubuntu 26.04.1 VM, packages from US-2234)

`kernel.apparmor_restrict_unprivileged_userns = 1` (Ubuntu default). Per-process state read from
`/proc/<pid>/cmdline`, `status` (Seccomp) and `ns/user`.

| Package | Starts | Sandbox |
|---|---|---|
| `.deb` | Yes | **On.** The builder-generated `postinst` (`app-builder-lib/templates/linux/after-install.tpl`) installs `apparmor-profile.tpl` as `/etc/apparmor.d/persephone` for `/opt/persephone/persephone`, which grants `userns`. `chrome-sandbox` stays `0755` (no setuid needed). The zygotes run in their own user namespace; web renderers have seccomp mode 2. `postrm` removes the profile. |
| AppImage | Only with `libfuse2t64` installed (not on a clean Ubuntu 26.04) | **Off.** electron-builder's generated `AppRun` (`appImageUtil.js` `generateAppRunScript`) probes `unshare -Ur true` and, when it fails, adds `--no-sandbox` itself. Every process ran with `--no-sandbox`, no seccomp, host user namespace. `executableArgs: []` does not prevent this; the script has no template to override. |

The one `--no-sandbox` renderer in the `.deb` run is the app's own Node-integrated window (`nodeIntegration: true`),
the same as on Windows; it is not a sandbox failure.

Debian 13 does not restrict unprivileged user namespaces, so the AppImage is expected to run sandboxed there
(checked in US-2240).

## Decision needed (user)

The AppImage cannot be sandboxed on stock Ubuntu: an AppImage cannot install an AppArmor profile, and its mount path
is random, so a path-based profile would have to match `/tmp/.mount_*`, which any local program could use.

| Option | Effect |
|---|---|
| **A. `.deb` only for the first release** | Drop the `AppImage` target. Ubuntu and Debian users install the `.deb`. Simplest; nothing unsandboxed ships. |
| **B. AppImage with a sandbox guard** (recommended if a portable build matters) | Keep the AppImage for distributions that allow user namespaces (Debian, Fedora, Arch). Switch to electron-builder's static AppImage runtime (`toolsets.appimage: "1.0.3"`, beta) so it needs no `libfuse2`. At startup, when running as an AppImage (`APPIMAGE` set) with `--no-sandbox` on the command line, show a message ("this system blocks the sandbox the AppImage needs; on Ubuntu install the .deb") and quit. The guard is a Linux platform-collaborator rule in main. |
| C. Ship as built | Runs unsandboxed on Ubuntu. Breaks decision 4; not recommended. |

## Implementation (after the decision)

- **A:** remove the `AppImage` target and `appImage:` block from `electron-builder.yml`; US-2237's AppImage
  pattern stays harmless; US-2238 and US-2239 drop the AppImage.
- **B:** `toolsets.appimage: "1.0.3"` in `electron-builder.yml`; a main-process guard owned by a Linux collaborator
  (no new `process.platform` branch); one English message (translated at epic close); re-measure on both clean VMs.

## Acceptance Criteria

- [x] `.deb` sandboxed on Ubuntu 26.04 (measured above).
- [x] `.deb` sandboxed on Debian 13 (measured 2026-11-27, same process check).
- [x] AppImage dropped (option A): `AppImage` target and `appImage:` removed from `electron-builder.yml`, the release job builds and uploads only the `.deb`, docs updated. Debian 13 measurement: the AppImage needs `libfuse2` there too and, with it, runs sandboxed.

## Files Changed

| File | Change |
|---|---|
| `electron-builder.yml` | Per decision (A or B) |
| Linux main-process collaborator (B only) | Sandbox guard |

No changes for the `.deb`: the builder's own `postinst`/`postrm` and AppArmor profile are used as generated.
