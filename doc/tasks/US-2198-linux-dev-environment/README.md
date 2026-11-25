# US-2198: Linux development environment and first launch

**Epic:** [EPIC-212](../../epics/EPIC-212.md) · **Owner:** Claude (live) · **Started:** 2026-11-25

## Goal

Get the development build (`npm start`) running in the user's WSL Ubuntu 26.04 and record every failure on the way to a
working window. Fixes go to US-2200 unless they block the bring-up itself.

## Background

- Epic decisions 1, 5 and 6 apply:
  - the target is WSL Ubuntu 26.04.1 LTS with WSLg;
  - the WSL copy is a separate checkout with its own `node_modules`;
  - the Windows checkout stays the source of truth.
- The static evidence is the [inventory](../../reviews/multiplatform-2026-11/inventory.md). The findings below
  refer to its `WIN-n` items where they overlap.

## Environment (done 2026-11-25)

The distro's default user is `root`. Electron should not run as root (it needs `--no-sandbox` there, which would hide
sandbox problems), so a normal user does the work. The default user is unchanged.

As root, once:

```bash
apt-get install -y libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0t64 libcups2t64 \
    libdrm2 libsecret-1-0 build-essential curl xz-utils fonts-noto-core
useradd -m -s /bin/bash dev
```

As `dev` (`wsl -u dev`):

- Node 24 from the official tarball (`latest-v24.x`, v24.22.3) unpacked into `~/.local/node`.
- `~/.profile` puts `~/.local/node/bin` first in `PATH`. Without it, WSL's Windows PATH interop finds the Windows
  `npm` (`/mnt/c/Program Files/nodejs/npm`).
- `npm ci`, then `node node_modules/electron/install.js` (see F2).

### Keeping the WSL copy in sync

`rsync` from the Windows checkout. Build outputs, dependencies, test reports and local data are skipped:

```bash
rsync -a --delete \
    --exclude node_modules --exclude .vite --exclude release --exclude dist --exclude out \
    --exclude target --exclude .git --exclude '*.exe' \
    --exclude integration-test/reports --exclude .persephone --exclude temp --exclude .i18n-work \
    /mnt/c/projects/persephone/ ~/persephone/
```

- Never add `--delete-excluded`: it would delete the WSL copy's own `node_modules` and `.vite`.
- The first sync takes about 2 minutes, because reading `/mnt/c` is slow. Later syncs copy only what changed.
- No commits are made to move code.
- Run `npm ci` again only when `package-lock.json` changed.
- Vite in WSL picks up synced renderer changes through HMR. Synced main-process changes restart Electron.

### Driving the WSL instance

- `mcp.enabled: true` and `mcp.port: 7875` are set in `~/.config/persephone/data/appSettings.json`.
- Port 7875 avoids the Windows instance's 7865. WSL's localhost forwarding (`networkingMode=nat`) makes it reachable
  from Windows at `http://127.0.0.1:7875/mcp`.
- A small MCP client from Windows can drive it.
- The window appears on the Windows desktop as "Persephone (Ubuntu)" (a WSLg window). `PrintWindow` on it captures
  only the Persephone window.

## Findings

| # | Finding | Inventory | Where it goes |
|---|---------|-----------|---------------|
| F1 | `npm ci` failed. `koffi` 2.9.0's Linux binary needs an executable stack, and glibc 2.43 (Ubuntu 26.04) refuses it: "cannot enable executable stack as shared object requires: Invalid argument". koffi ≥ 2.10.1 loads. | new | **Fixed here:** koffi pinned to `2.16.3` in `package.json` and the lockfile. 2.16.4 was skipped because it was under two weeks old. |
| F2 | `npm ci` does not download the Castlabs Electron runtime (`node_modules/electron/dist` is missing); `node node_modules/electron/install.js` fetches it. This is the same as the Windows note in `agents-common.md`. | — | Linux development doc (`/document` at epic close) |
| F3 | Electron starts as a normal user without a SUID `chrome-sandbox`: WSL allows unprivileged user namespaces, so the zygote sandbox works. Real Ubuntu 24.04+ restricts them through AppArmor. | roadmap §7 | Packaging phase (AppArmor profile); check in the Hyper-V VM |
| F4 | Under WSLg, Chromium picks X11 (`--ozone-platform=x11`, XWayland), because WSLg does not set `XDG_SESSION_TYPE`. A real GNOME session will run native Wayland. | — | Hyper-V VM check (later phase) |
| F5 | **No local file opens.** `isPlausibleFilePath` accepts only drive letters and UNC paths, so `/home/...` shows "Invalid file path". `normalizeFileUrl` strips the `/` root from `file:///` URLs. With a two-line local patch in the WSL copy, open, edit and save all work. | WIN-22 | **US-2200** (blocker) |
| F6 | The pipe server listens on `\\.\pipe\persephone-dev` as a Unix socket path, which creates a socket file with that literal name in the working directory. | WIN-6 | US-2200 (already listed) |
| F7 | The data folder is `~/.config/persephone`, from `app.getPath`. The WIN-26 fallback was not reached. | WIN-26 | US-2200 keeps the fallback fix |
| F8 | `setAppUserModelId` / `setAppDetails` run only for `--profile` and board windows, so the first launch does not reach them. | WIN-38 | US-2200 (unchanged) |
| F9 | `appSettings.json` comments and defaults describe Windows tools (`tor.exe`, `vlc.exe`, `pwsh`/`cmd`, `mneme.exe`). | several | US-2201 (parity pass) |
| F10 | `window.close-to-tray` defaults to true. Stock GNOME shows no tray icons, so closing the last window could leave a hidden app with no way back. Not tested yet. | — | US-2201, check first |
| F11 | The Windows working copy has CRLF line endings, and rsync copies them as they are. This is harmless for TS/JS, but a shell script run in WSL needs LF. | — | Note in the Linux development doc |
| F12 | Startup log is clean apart from the above: Widevine CDM updates, the clipboard store, MCP and Vite HMR all work. | — | — |

## Not yet verified

- **Windows after the koffi bump.** The Windows `node_modules` still has koffi 2.9.0, because a running dev Persephone
  holds it.
  - After that instance is closed, run `npm ci` and `npm run typecheck`.
  - Then run the `--desktop 2` placement check from EPIC-211, which goes through `virtual-desktop-manager.ts` and
    koffi.
  - koffi stays on the 2.x API, and the `build/koffi/win32_x64/koffi.node` path that `electron-builder.yml` packages
    still exists in 2.16.3.
- A cold start after the US-2200 fixes, without the local WIN-22 patch.

## Acceptance criteria

- [x] The WSL checkout, Node, the build dependencies and the sync method are chosen and written down (above).
- [x] `npm start` opens the main window in WSL.
- [x] Files open, edit and save. This needs the local WIN-22 patch until US-2200 lands.
- [x] Every failure up to a working window is recorded, with where it goes.
- [x] Windows checked after the koffi bump. Run on 2026-11-25: `npm install` changed only koffi, and
  `npm run test:ui -- --area core/virtual-desktop --with virtual-desktop --desktop 2` gave 1 passed.

## Files changed

| File | Change |
|------|--------|
| `package.json`, `package-lock.json` | `koffi` 2.9.0 → 2.16.3 (F1) |
| `doc/tasks/US-2198-linux-dev-environment/README.md` | This document |
| `doc/epics/EPIC-212.md`, `doc/active-work.md` | Task link and status; F5 added to US-2200 |
