# EPIC-219: SSH board (remote trees phase 3)

## Status

**Status:** Active
**Created:** 2026-11-28

## Overview

Phase 3 of the [remote trees roadmap](../reviews/remote-trees-roadmap.md). A new **SSH** board in the
`persephone-boards` repo (`boards/ssh/`) lets the user save SSH connections, open a remote folder as an Explorer tree,
open and save remote files, and copy or move files between the remote tree and local or other board trees. It builds on
[EPIC-217](EPIC-217.md) (board tree providers) and [EPIC-218](EPIC-218.md) (chunked writes, transfers, read-only
trees).

The user's requirement: the board **remembers connections, including their credentials, in Persephone's env variables**
(the per-board namespace in `.env.json`, optionally encrypted), never in the board folder.

| Area | Today | File |
|---|---|---|
| Board env vars | `persephone.var.get/set` for the board **page** only; the store, its creation dialog and its decrypt prompt live in the renderer | `src/renderer/api/board-vars/BoardEnvStore.ts`, `board-vars-bridge.ts` |
| Service → app requests | A board service already asks the renderer for board settings: service → main (`board-settings-get`) → `requestRenderer` | `src/module-service-host/service-api.ts`, `src/main/module-service/board-settings-adapter.ts` |
| Board trees | `persephone.treeProviders.register` (list/stat, optional mkdir/rename/delete), `readOnly` on the root listing | `assets/guides/boards/content-providers.md` |
| Board content | `persephone.providers.register` with `readRange` and chunked `beginWrite` (bridge 1.66.0) | same |
| Open a tree | `persephone.openTree(...)` from the board page | `assets/guides/agents/boards/` |
| Service board precedent | `torrent-viewer` (service + content provider) | `persephone-boards/boards/torrent-viewer/` |

## Goals

- **Exit:** on `persephone-vm`, save a connection (key or password), open its home folder as an Explorer tree, open,
  edit and save a remote file, copy a local folder in and a remote file out, with a read-only connection showing no
  write actions. The same works against a container with the SFTP subsystem disabled.
- Connections and their secrets live only in the board's env-var namespace.
- Restoring Persephone with a saved SSH tree page reconnects without the board page being open.

## Linked Tasks

| Task | Repo | Title | Owner | Status |
|------|------|-------|-------|--------|
| US-2259 | persephone | **Env vars in board services.** `persephone.var.get/set/delete/keys` in the module-service API, scoped to the board's own namespace, answered by the renderer's `BoardEnvStore` through the board-settings route (service → main → `requestRenderer`). The request must wait for the store-creation dialog or the decrypt prompt (no short deadline), and reject cleanly when the user declines or no window is open. Bridge 1.67.0 + history line; `services.md` and `languages-and-env.md` guides | Codex (plan + implement), Claude review | Planned |
| BT-103 | persephone-boards | **SSH board and connections page.** Scaffold `boards/ssh/` with `boards.createBoard`; page lists saved connections; add/edit/delete; fields: name, host, port, user, auth (agent / key file / password), key path, start folder, writable switch; secrets in separate vars; **Test connection** shows the host-key fingerprint and **Trust** stores it; **Open** calls `persephone.openTree`. Optional import of `~/.ssh/config` `Host` aliases to prefill the form | Codex (plan + implement), Claude review | Planned |
| BT-104 | persephone-boards | **SSH service over SFTP.** Vendor `ssh2` as one committed bundle (no native add-ons, license copied). One session per connection, idle disconnect, reconnect on demand, strict host-key check against the trusted key. One `ssh:` content provider with `tree: true`: list/stat/read/readRange, chunked writes (temp name + rename on commit), mkdir/rename/delete only for writable connections, `readOnly` on the root listing otherwise | Codex (plan + implement), Claude review | Planned |
| BT-105 | persephone-boards | **Watch by polling.** `watch` on an open remote file polls `stat` (size + mtime) on an interval while watched; stops when unwatched or the session drops | Codex (plan + implement), Claude review | Planned |
| BT-106 | persephone-boards | **Exec-channel fallback.** When the server has no SFTP subsystem: listing and stat via `ls`/`stat` output, read via `cat`/`dd` ranges, writes via base64 chunks to a temp file + `mv`. Safe quoting of every path | Codex (plan + implement), Claude review | Planned |
| BT-107 | persephone-boards | **Verification and release prep.** Run the exit criteria on `persephone-vm` (SFTP) and in a container with SFTP disabled; README, `WHATS-NEW.md`, screenshot with no personal data; `minAppVersion` set to the Persephone release that carries bridge 1.67.0 | Claude (runs on the VM), Codex fixes | Planned |

**Order:** US-2259 → BT-103 → BT-104 → BT-105 → BT-106 → BT-107. BT-103 can start against the page-side
`persephone.var` while US-2259 is under way.

## Epic-level decisions

Settled by Claude's recommendation; the user may override before the plans are written.

1. **Everything about a connection lives in env vars.** Key `SSH_CONNECTIONS` holds a JSON list of connection records
   (name, host, port, user, auth method, key path, start folder, writable, trusted host-key fingerprint). Secrets get
   their own keys (`SSH_<ID>_PASSWORD`, `SSH_<ID>_PASSPHRASE`) so the list can be shown or exported without them. The
   board folder holds no connection data; uninstalling and reinstalling the board keeps the connections.
2. **The service reads vars itself (US-2259).** A restored Explorer tree must reconnect with no board page open, so
   credentials cannot be handed over by the page. This adds a bridge method; it reuses the board-settings request path,
   no new protocol (guardrail 1).
3. **Pages persist the connection id only** (roadmap decision 2): `ssh://<connection-id>/<path>`. A link naming an
   unknown connection fails; the board never connects to a host named by a link (roadmap decision 4).
4. **Host keys: trust on first use, from the page only.** The service never prompts. An unknown or changed key fails
   with "Open the SSH board to trust this host"; the page's Test connection shows the SHA-256 fingerprint and Trust
   records it. A changed key is shown as a warning, never auto-accepted.
5. **Read-only by default, editable on the board** (roadmap decision 3). Each connection has a **Writable** switch on
   the connections page, off for a new connection and changeable at any time (stored in its `SSH_CONNECTIONS` record).
   The service re-reads the current setting before every write (write, chunked write, mkdir, rename, delete) and
   refuses when it is off, and returns `readOnly: true` on the root `treeList` result. Persephone re-reads that flag on
   every root listing, so after a toggle the board refreshes or reopens that connection's open tree; until then the
   service still blocks writes.
6. **Auth methods:** SSH agent (Windows OpenSSH pipe `\\.\pipe\openssh-ssh-agent`, `SSH_AUTH_SOCK` on Linux), key file
   with an optional passphrase var, password var. No keyboard-interactive or 2FA in this epic.
7. **One board, one scheme.** Board id `ssh`, scheme `ssh:`; the same provider serves files and folders (roadmap
   decision 1).
8. **Unpublished until Persephone ships 1.67.0.** The board stays on `develop` until then.

## Out of scope

- FTP and Kudu (phases 4–5), port forwarding, terminals, `tail -f` streaming, remote search.
- Jump hosts / `ProxyJump`, keyboard-interactive and 2FA auth.
- Editing `~/.ssh/config` or `known_hosts`; the board only reads `~/.ssh/config` to prefill.

## Concerns

- **Prompts inside a service request.** The first `persephone.var` call can block on the store-creation dialog or the
  decrypt prompt. US-2259 must give var requests no short deadline, and the tree's first listing should surface "waiting
  for the env-variable store" rather than time out.
- **Vendoring `ssh2`.** Its optional `cpu-features` native add-on must be left out; the pure-JS crypto path must load
  from a clean checkout outside any `node_modules` (repo rule).
- **Exec fallback correctness.** `ls` output differs between GNU and BusyBox; parsing must use a fixed format
  (`stat -c` / `find -printf` when present) and quote every path. Binary-safe reads need `base64` on the server.
- **Testing never touches customer servers** (roadmap decision 5). `persephone-vm` and containers on it only.
- **Secrets in memory and logs.** The service must never log a password, passphrase or key; errors name the connection,
  not the credential.
