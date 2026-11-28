# EPIC-220: FTP board (remote trees phase 4)

## Status

**Status:** Completed 2026-11-28
**Created:** 2026-11-28

## Overview

Phase 4 of the [remote trees roadmap](../reviews/remote-trees-roadmap.md). A new **FTP** board in the
`persephone-boards` repo (`boards/ftp/`) lets the user save FTP/FTPS connections, open a remote folder as an Explorer
tree, open and save remote files, and copy or move files between the remote tree and local or other board trees. It
follows the [EPIC-219](EPIC-219.md) SSH board almost one to one.

Before the board, the epic closes the three host follow-ups EPIC-219 left open, because every board tree (SSH now, FTP
next, Kudu later) hits them:

1. Board-backed pages restored at startup open empty (their service's var request fails fast while the window starts).
2. Open board folders never refresh by themselves (no tree watch route for board providers).
3. A board tree stays read-only after its service restarts until the user refreshes it.

| Area | Today | File |
|---|---|---|
| SSH board (the pattern to copy) | Connections page, env-var records + secret vars, shared session with idle disconnect, temp-name writes, file watch by polling | `persephone-boards/boards/ssh/` |
| Board trees | `persephone.treeProviders.register` (list/stat, optional mkdir/rename/delete), `readOnly` on the root listing | `src/module-service-host/tree-provider-dispatch.ts`, `src/renderer/content/tree-providers/ProxyTreeProvider.ts` |
| Board content | `persephone.providers.register` with `readRange`, chunked `beginWrite`, `watch` | `src/module-service-host/provider-dispatch.ts`, `assets/guides/boards/content-providers.md` |
| Service env vars | `persephone.var.*` in services; fail fast with `window-unavailable` while the window starts | US-2259 (EPIC-219) |
| Bridge | `BOARD_BRIDGE_VERSION` 1.67.0 | `src/shared/board-bridge-version.ts` |

## Goals

- **Exit:** on `persephone-vm`, save an FTP connection and an FTPS one (self-signed certificate trusted from the page),
  open the start folder as an Explorer tree, open, edit and save a remote file, copy a local folder in and a remote file
  out, with a read-only connection showing no write actions; a file changed on the server updates its open page, and an
  open folder shows a file added on the server without a manual refresh.
- Restoring Persephone with a saved SSH or FTP tree page and an open remote file shows their content without a reload.
- Restarting a board service leaves its open writable tree writable.

## Linked Tasks

| Task | Repo | Title | Owner | Status |
|------|------|-------|-------|--------|
| US-2261 | persephone | **Restore board-backed content after the window is ready.** A restored page whose content or tree comes from a board service loads it once the window answers renderer RPC (vars, prompts), instead of failing during restore and needing a reload. | Codex (plan + implement), Claude review | Done; reviewed, live-verified |
| US-2262 | persephone | **Tree watch route for board providers.** Optional `watch` on `persephone.treeProviders.register`; the host watches folders an Explorer currently shows (root + expanded) and refreshes them on change. Bridge 1.68.0 + history line; guides. | Codex (plan + implement), Claude review | Done; reviewed, live-verified |
| US-2263 | persephone | **Board tree write state after a service restart.** When a board's provider registers again, open trees of that type re-read the root `readOnly` flag (re-list the root) so write actions come back without a manual refresh. | Codex (plan + implement), Claude review | Done; reviewed, live-verified |
| BT-108 | persephone-boards | **FTP board and connections page.** Scaffold `boards/ftp/` from the SSH board's page: name, host, port, protocol (FTP / FTPS explicit / FTPS implicit), user, password (secret var, may be empty for anonymous), start folder, writable switch. Vendor `basic-ftp` as a self-contained bundle in `lib/` (like `ssh2`). **Test connection** connects once from the (possibly unsaved) form; for FTPS a certificate that fails system validation shows its SHA-256 fingerprint and **Trust certificate** pins it. **Open** calls `persephone.openTree`. | Codex (plan + implement), Claude review | Done; live-verified |
| BT-109 | persephone-boards | **FTP service: trees and files.** Reads connections and the password from env vars. A small client pool per connection (FTP allows one transfer per control connection), idle disconnect, reconnect on demand, pinned-certificate check on every connect. One `ftp:` content provider with `tree: true`: list/stat/read, `readRange` (REST offset), chunked writes (STOR to a temp name, rename on commit, delete on abort), mkdir/rename/delete only for writable connections, `readOnly` on the root listing otherwise. | Codex (plan + implement), Claude review | Done; live-verified |
| BT-110 | persephone-boards | **Watches.** FTP: watch open files by polling size + modification time (as the SSH board does) and open folders through US-2262. SSH: add the folder watch through US-2262 to the existing board. | Codex (plan + implement), Claude review | Done; live-verified |
| BT-111 | persephone-boards | **Verification and release prep.** Exit criteria on `persephone-vm` against a local FTP server with plain FTP and FTPS (self-signed); README, `WHATS-NEW.md`, screenshot with no personal data; `minAppVersion` / bridge 1.68.0 for FTP and the SSH board update. | Claude (runs on the VM), Codex fixes | Done: VM checks recorded in BT-108..BT-110; README, WHATS-NEW, screenshot; publish after 5.0.24 |

**Order:** US-2261 → US-2262 → US-2263 → BT-108 → BT-109 → BT-110 → BT-111. The three host tasks touch the same
restore and tree-provider code, so they run one after another. BT-108 does not need them and may start in parallel.

## Epic-level decisions

Settled by Claude's recommendation; the user may override.

1. **Copy the SSH board's structure, not share code.** Boards are self-contained folders (no nesting, no shared board
   library). The FTP board copies the connections page, the env-var layout and the session/lease and watch patterns,
   adapted to FTP. `FTP_CONNECTIONS` holds the records; `FTP_<ID>_PASSWORD` the secret.
2. **Library: `basic-ftp`** (MIT, no runtime dependencies, FTP + explicit/implicit FTPS, MLSD with LIST fallback,
   `REST` offsets). Bundled into `lib/` with a build script and committed, like `ssh2.bundle.cjs`. Passive mode only,
   which is all `basic-ftp` supports.
3. **Certificates: trust on first use, from the page only** (mirrors SSH host keys). A certificate that passes system
   validation is accepted. One that fails is refused by the service with "Open the FTP board to trust this
   certificate"; the page's Test connection shows its SHA-256 fingerprint and **Trust certificate** pins it in the
   record. A pinned certificate that changes is refused, never auto-accepted. Plain FTP is allowed but labeled
   "unencrypted" on the page.
4. **Pages persist the connection id only** (roadmap decision 2): `ftp://<connection-id>/<path>`. Links never name a
   host (roadmap decision 4).
5. **Read-only by default** (roadmap decision 3), the same Writable switch and per-write re-check as the SSH board.
6. **Host watch is by folder, board decides how.** US-2262 adds a tree `watch(config, path)` route the host calls for
   folders it is showing; the board polls them (listing compare) and emits a change; the host re-lists that folder.
   No push protocol, no new correlator: it reuses the content-provider watch event path (guardrail 1).
7. **One bridge bump for the epic:** 1.68.0 (US-2262 adds the board-facing API; US-2261 and US-2263 add none). All of
   it ships in 5.0.24 with 1.67.0, so the SSH and FTP boards both publish after 5.0.24.

## Out of scope

- SFTP inside the FTP board (the SSH board covers it), active-mode FTP, FXP server-to-server transfer, proxies.
- Kudu (phase 5), remote search, `tail -f`.
- Preserving timestamps or permissions on upload.

## Concerns

- **One transfer per control connection.** Listing while a download runs needs a second control connection; the pool
  size is a tuning constant (start at 2–3) and some servers cap connections per user.
- **`readRange` over FTP** is `REST <offset>` + `RETR` cut after N bytes, which aborts the data connection; the client
  used for that read may need to be discarded. The plan must state how the pool handles it.
- **Rename over an existing file** is refused by some servers; commit may need delete-then-rename (non-atomic), the
  same trade-off the SSH exec fallback documents.
- **Folder polling cost.** Polling every expanded folder on a slow FTP server is chatty; the board polls only watched
  folders, at a longer interval than files, and stops when unwatched.
- **Test server.** `persephone-vm` has no Docker; the FTP server runs on the VM itself (vsftpd from apt: units `vsftpd-test-explicit` on 21 and `vsftpd-test-implicit` on 990), with a throwaway user and a self-signed certificate.
- **Testing never touches customer servers** (roadmap decision 5).
- **Secrets** are never logged; errors name the connection, not the credential.
