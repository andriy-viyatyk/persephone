# Linux development environment

This is a development setup for Linux. For installation, use the Linux instructions in the user
guides; this document covers development and package creation. The validated environment is Ubuntu
26.04 inside WSL with WSLg, using a normal non-root Linux user and a checkout in the WSL filesystem.

## WSL checkout

Keep a separate checkout such as `~/persephone` inside the Linux filesystem, with its own
`node_modules`. The Windows checkout remains the source of truth. Sync source changes from the
Windows checkout with `rsync`:

```bash
rsync -a --delete \
    --exclude node_modules --exclude .vite --exclude release --exclude dist --exclude out \
    --exclude target --exclude .git --exclude '*.exe' \
    --exclude integration-test/reports --exclude .persephone --exclude temp --exclude .i18n-work \
    /mnt/c/projects/persephone/ ~/persephone/
```

Do not add `--delete-excluded`: the Linux checkout's `node_modules` and `.vite` are local and
must survive syncs. The initial sync is slower because it reads through `/mnt/c`; later runs copy
only changed files. Run `npm ci` again when `package-lock.json` changes.

The Windows checkout uses CRLF line endings. `rsync` preserves them; this is fine for TypeScript
and JavaScript, but shell scripts run in WSL need LF line endings.

## Rust helpers

Install Rust separately in both the WSL environment and the Ubuntu VM. The validated WSL setup
used rustup's minimal profile, and the VM already had Rust installed. For a fresh environment in
either one, install rustup as the normal Linux user:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --profile minimal
```

Ensure the Cargo bin directory is on the login-shell `PATH` (add this line to `~/.profile` if
needed), then verify the toolchain:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo --version
```

After syncing source into each `~/persephone` checkout, build both release helpers there:

```bash
cargo build --release --manifest-path mneme/Cargo.toml
cargo build --release --manifest-path snip-tool/Cargo.toml
```

The development app looks for `mneme/target/release/mneme` and
`snip-tool/target/release/persephone-snip`. Source sync excludes `target`, so build the helpers
separately after syncing. On Linux, the snip helper's no-argument invocation opens the desktop
Screenshot portal for an interactive capture; other subcommands remain unsupported. The portal
response is read from its local file URI, and the helper attempts to remove that returned file.

## Build Linux packages

Linux packages build only on Linux: use the separate checkout in WSL or the VM (not `/mnt/c`) with its own
`node_modules`, Node 24 and Rust. Then:

```bash
npm ci
node node_modules/electron/install.js
cargo build --release --manifest-path mneme/Cargo.toml
cargo build --release --manifest-path snip-tool/Cargo.toml
npm run dist:linux
```

`release/` then holds `persephone-<version>-linux-amd64.deb`, which installs to `/opt/persephone`. It carries `mneme` and `persephone-snip` beside the
`persephone` executable, where `getMnemeExePath()` and `getSnipToolPath()` look for them, and only the
`linux_x64` koffi build. electron-builder warns but continues when a helper is missing, so build both crates
first. The desktop entry `com.viyatyk.persephone.desktop` (from `desktopName`, `syncDesktopName`) offers
"Open With" for plain text and folders and passes `%U`; `file://` operands are converted to paths in
`src/main/launch-operand.ts`. URL handling stays with the app's own handler entry
(`linux-browser-registration.ts`). The `afterSign` hook (`scripts/vmp-sign.mjs`) does not run for Linux
targets, and returns early on Linux if it ever does: VMP signing exists only for Windows and macOS.

- **glibc floor.** The packages need the build machine's glibc: on Ubuntu 26.04 (glibc 2.43) `mneme` links
  `libm` symbols versioned 2.43 and will not start on Debian 13 (glibc 2.41). Release packages are built on
  Ubuntu 24.04 (glibc 2.39) in the release workflow. A package built in WSL or the dev VM is for local checks
  on Ubuntu 26.04 only.
- **Dependencies.** `deb.depends` in `electron-builder.yml` lists electron-builder's defaults plus every
  library `dpkg-shlibdeps` reports. Re-run the audit when Electron or a helper changes:

  ```bash
  mkdir -p /tmp/pk/debian && cd /tmp/pk && dpkg-deb -x ~/persephone/release/*.deb x
  printf 'Source: persephone

Package: persephone
Architecture: amd64
' > debian/control
  ELF=$(find x/opt/persephone -type f -exec file {} + | grep -E 'ELF.*(executable|shared object)' | cut -d: -f1)
  LD_LIBRARY_PATH=$PWD/x/opt/persephone dpkg-shlibdeps -O --ignore-missing-info $(printf -- '-e%s ' $ELF)
  ```

  Every package in the printed `shlibs:Depends` must appear in `deb.depends` (koffi's `uv_*` warnings are
  expected: Electron provides libuv).
- **Sandbox.** The `.deb`'s builder-generated `postinst` installs an AppArmor profile for
  `/opt/persephone/persephone`, so Chromium's namespace sandbox works on Ubuntu 26.04 without the setuid
  helper. There is no AppImage: electron-builder's AppImage launcher (`AppRun`) adds `--no-sandbox` by
  itself when unprivileged user namespaces are blocked, which is Ubuntu's default, and it needs `libfuse2`.
  Never add `--no-sandbox` yourself.
- **Network.** The first build downloads Electron and fpm into electron-builder's cache;
  later builds reuse it. A clean offline build is not supported.

## Runtime dependencies

Install the Electron runtime libraries, build tools, and fonts needed by the development build:

```bash
sudo apt-get install -y libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0t64 libcups2t64 \
    libdrm2 libsecret-1-0 build-essential curl xz-utils fonts-noto-core
```

Use Node 24 from the official Linux tarball (the validated setup used v24.22.3 under
`~/.local/node`) and put `~/.local/node/bin` before the Windows PATH entries in the WSL user's
`PATH`. Otherwise WSL interop may find Windows `npm` instead of Linux `npm`.

From the Linux checkout, install the locked dependencies and fetch the Castlabs Electron runtime:

```bash
npm ci
node node_modules/electron/install.js
```

`npm ci` does not fetch this Electron distribution automatically. The Linux `koffi` dependency
is pinned at 2.16.3; older 2.9.0 failed to load on Ubuntu 26.04 because its executable-stack
requirement is rejected by glibc 2.43.

## Run and sync loop

Run `npm start` from the WSL checkout. WSLg displays the window on the Windows desktop. Renderer
changes arrive through Vite HMR; main-process changes restart Electron. The validated setup used
an MCP port distinct from the Windows instance (7875 instead of 7865).

This setup documents Linux development and package creation. Installation instructions are in the
user guides; the release process is documented in [`release-process.md`](standards/release-process.md).

## Ubuntu VM (desktop checks)

WSL's GUI support is not a GNOME desktop, so desktop-integration checks (EPIC-214) run in a Hyper-V VM:
`persephone-vm`, Ubuntu 26.04.1 Desktop, GNOME on Wayland, user `dev` with automatic login and passwordless
`sudo`. It needs membership in the local **Hyper-V Administrators** group, not elevation.

### Development dock identity

Install a per-user desktop entry to give the dev app its own dock icon and XWayland window class. From the
Linux checkout, substitute its absolute path and the Node installation from the WSL setup above:

```bash
checkout="$(realpath ~/persephone)"
node="$(realpath "$HOME/.local/node/bin/node")"
mkdir -p "$HOME/.local/share/applications"
sed -e "s|@CHECKOUT@|$checkout|g" -e "s|@NODE@|$node|g" \
    scripts/linux-vm/com.viyatyk.persephone.desktop \
    > "$HOME/.local/share/applications/com.viyatyk.persephone.desktop"
chmod +x "$HOME/.local/share/applications/com.viyatyk.persephone.desktop"
desktop-file-validate "$HOME/.local/share/applications/com.viyatyk.persephone.desktop"
```

The entry launches `scripts/dev.mjs` directly, uses the checkout's absolute `assets/icon.png`, and sets
`StartupWMClass` for XWayland grouping. Remove it with:

```bash
rm "$HOME/.local/share/applications/com.viyatyk.persephone.desktop"
```

This is a development-only entry. The packages install their own entry with the same name (see "Build Linux packages"), so remove this one before installing a package on the same machine.

Agents control it with plain OpenSSH (key `~/.ssh/persephone-vm`, host alias `persephone-vm` in `~/.ssh/config`,
password login disabled) and with [`scripts/linux-vm/vm.ps1`](../scripts/linux-vm/vm.ps1):

| Command | Does |
|---|---|
| `ssh persephone-vm '<command>'` | Run any shell command in the VM |
| `vm.ps1 status`, `start`, `stop` | VM state, and whether its address answers |
| `vm.ps1 sync` | Copy the Windows checkout into `~/persephone` (keeps the VM's `node_modules`) |
| `vm.ps1 app-start [x11]`, `app-stop`, `app-log` | Run `npm start` as a `systemd --user` unit inside the GNOME session; `x11` runs it through XWayland |
| `vm.ps1 tunnel` | Forward the VM app's MCP port 7875 to Windows `localhost:7875` |
| `node scripts/linux-vm/mcp-call.mjs <path> [args]` | Call the VM app's MCP through the tunnel |
| `vm.ps1 screenshot [file]`, `type "<text>" -Enter`, `key ctrl+alt+t` | See (1920x1080, 1:1) and type into the VM console without SSH |
| `vm.ps1 input-setup`, then `ssh persephone-vm '~/persephone/scripts/linux-vm/ptr.sh click 900 45'` | Real pointer and key input in the session (ydotool): clicks, drags, shortcuts |
| `vm.ps1 checkpoint <name>`, `restore <name>`, `checkpoints` | Hyper-V checkpoints (`dev-ready` holds the configured dev setup) |
| `vm.ps1 fix-network` | Re-address the VM after a Windows reboot moved the Default Switch subnet |

Setup notes:

- **Install:** unattended, from the desktop ISO with an `autoinstall.yaml` added at its root and `autoinstall` on the
  boot command line (`xorriso ... -map ... -boot_image any replay`). Generation 2 VM, Secure Boot with the
  `MicrosoftUEFICertificateAuthority` template, 4 vCPU, 8 GB, 80 GB disk, `Default Switch`.
- **Network:** DHCP on the Default Switch does not answer on this host, so the VM has a static address
  (`<switch network>.50`, gateway and DNS at the host's switch address) in `/etc/netplan/50-static.yaml`, with IPv6
  link-local only. NAT and DNS work. `fix-network` types the new address through the console keyboard.
- **Console typing:** `Msvm_Keyboard.TypeText` drops and reorders keys; `vm.ps1 type` sends one key at a time.
- **Chromium sandbox:** Ubuntu 26.04 blocks unprivileged user namespaces, so after `npm ci` run
  `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`
  (CI does the same). Do not use `--no-sandbox`.
- **MCP:** enable it in the VM profile (`"mcp.enabled": true`, `"mcp.port": 7875` in
  `~/.config/persephone/data/appSettings.json`). The tunnel keeps the port number because the MCP server checks the
  `Host` header's port. Stop a WSL Persephone first; WSL forwards the same localhost port.
- **Screen lock and idle blanking are off** (`gsettings` over SSH with `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`);
  a locked session swallows console typing.
- **Display backend:** the app runs as a native Wayland client, Electron's default (US-2212).
  `npm start -- --ozone-platform=x11` runs it through XWayland as a fallback. Wayland apps cannot learn their window
  position, and GNOME drops clipboard writes from an app window that has had no user input.
- **Screen size:** 1920x1080, set in GNOME with `gdctl set --persistent ...`; the Hyper-V console window follows it.
- **UI tests:** run the suite in the VM over SSH from a login shell (`bash -lc`, so `npm` is on PATH) with the
  session variables above. Without `npm start` in the VM, run `npm run build-prod` and then
  `npm run test:ui -- --prod --area <area>`. The build replaces the dev bundle, so run `npm start` again afterwards.
  Against an installed package (`--app /opt/persephone/persephone`), unlock the login keyring first: the packaged
  build encrypts cookies through GNOME Keyring, the automatic login leaves it locked, and browser pages wait behind
  GNOME's unlock prompt (type the VM password into it once per boot).
- **GitHub Linux CI** (`.github/workflows/linux-ci.yml`) runs only on demand: the Actions tab, or
  `gh workflow run linux-ci.yml --ref <branch>`. The VM is the usual Linux check.

### Clean install VMs

Package install checks run in two VMs without development tools, so a library missing from the `.deb` is not
hidden by the dev setup. Both are built like `persephone-vm` (same `dev` user, SSH key, passwordless `sudo`,
automatic login, screen lock and blanking off) and have a `clean` checkpoint taken at the logged-in desktop.
Restore it before every install check. Every `vm.ps1` command takes `-Vm <name>`.

| VM | System | Address | Install source |
|---|---|---|---|
| `persephone-clean` | Ubuntu 26.04.1 Desktop | `<switch network>.51` | The desktop ISO with `autoinstall.yaml` (a late command writes the static netplan) |
| `persephone-debian` | Debian 13.8 GNOME (Wayland) | `<switch network>.52` | The netinst ISO with `preseed.cfg` and a one-entry `grub.cfg` (static network on the kernel command line) |

Install configs and credentials live in `%USERPROFILE%\VMs\<vm>\`, never in the repository. Each VM has 6 GB,
4 vCPU and a 60 GB disk. **Run one VM at a time**: the host cannot hold two of them next to WSL and Persephone.
`fix-network` writes Ubuntu's netplan, so it works only for the two Ubuntu VMs; after a subnet move, fix the
Debian VM's network from its console.

```powershell
./vm.ps1 stop; ./vm.ps1 restore clean -Vm persephone-clean; ./vm.ps1 start -Vm persephone-clean
scp release/persephone-*-linux-amd64.deb persephone-clean:
ssh persephone-clean 'sudo apt-get install -y ./persephone-*-linux-amd64.deb'
```

The Hyper-V thumbnail refuses a full-size capture on some VMs; `screenshot` then saves a 1280x720 image.
