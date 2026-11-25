# Linux development environment

This is a development setup for the Linux port work. Linux is not a supported user release
target yet; do not use this as an installation guide. The validated environment is Ubuntu 26.04
inside WSL with WSLg, using a normal non-root Linux user and a checkout in the WSL filesystem.

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

This setup documents only development and test work. Linux packaging, installation, and user
release instructions belong to the later Linux release phase.
