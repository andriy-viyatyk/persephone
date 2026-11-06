# EPIC-138: Persephone as a runtime for agent-built tools

## Status

**Status:** Recorded (not currently planned — listed in `doc/tasks/backlog.md`, 2026-11-06)
**Created:** 2026-11-06
**Completed:** —

## Overview

An agent asked to "build me a tool" should be able to install Persephone with one command, write
the tool as a board, and put a shortcut on the user's desktop. The user then runs that tool like
any other program. They do not have to know Persephone is underneath, or ever open Persephone
itself.

EPIC-136 already made boards run as standalone windows from a shortcut. This epic adds the rest:
- publishing to Windows package managers;
- a command-line interface an agent can call without MCP;
- a "board host" mode that shows no Persephone UI when only board windows are open;
- a guide an agent can find on the web before Persephone is installed.

## Goals

- `winget install AndriyViyatyk.Persephone` (and `scoop install persephone`) installs Persephone
  silently, per user, with no admin rights, and stays current with every release without manual
  work.
- After installation, a `persephone` command is on PATH. An agent can create a board, open it, and
  create a desktop shortcut for it from a terminal. Each command reports success or failure with an
  exit code and text the agent can read.
- When Persephone runs only because a board was launched, the user sees only that board's window:
  no tray icon, no update banner, and no Persephone main window.
- An agent with no prior knowledge of Persephone can find one web page with the whole recipe:
  install, write the board, create a shortcut.

## Non-goals

- **macOS and Linux.** The launcher, `.lnk` shortcuts, AppUserModelIDs and the installer are
  Windows-specific.
- **Silent trust.** Nothing in this epic trusts a board without the user. The first launch of an
  agent-built board shows the trust dialog in the board's own window (EPIC-136 decision 11). That
  is the one moment the user sees Persephone, and it stays.
- **A separate lightweight runtime.** Board windows stay ordinary Persephone windows in board mode
  (EPIC-136 decision 1).
- **npm distribution.** Shipping a Castlabs Electron app through npm is the wrong channel for end
  users.

## Background (verified 2026-11-06)

What already works:

- **Board-only cold start.**
  - `persephone-launcher.exe --board "<folder>"` forwards `BOARD <path>` over the launcher pipe, or
    starts Electron with the flag (`launcher/src/main.rs:164-167`).
  - Main parses it in `launchOperands()` / `parseLaunchArguments()` (`src/main/utils.ts`).
  - On a cold start, `takeBoardStartupInput()` makes `restoreState(false)` skip the normal window,
    so only the board window opens (`src/main/main-setup.ts:190-195`).
- **Lifetime.** Board windows close for real (`setCanQuit` → `close()`,
  `src/main/open-windows.ts:159`). With no normal window, `window-all-closed` quits the app
  (`src/main/main-setup.ts:257-261`).
- **Identity and shortcuts.**
  - Per-board AppUserModelID, icon and relaunch command: `src/main/board-window-identity.ts`.
  - The shortcut is written by `shell.writeShortcutLink` (`src/ipc/main/core-handlers.ts:127`),
    reached through the renderer API `boards.createShortcut(root, { linkPath, overwrite })`
    (`src/renderer/api/boards.ts:306`). That API refuses untrusted, non-bundled boards.
- **Installer.** NSIS (`oneClick: false`, `perMachine: false`, `allowElevation: true`), no desktop
  or Start-menu shortcut (`electron-builder.yml:79-110`). Custom script: `build/installer.nsh`,
  which already handles silent mode for the language page. The portable zip is built from the same
  configuration.
- **Releases.** `.github/workflows/publish.yml` runs on a tag and creates a draft release. The user
  publishes it by hand (release process, step 7).

What is missing:

- **Tray.** `setupTray()` runs on every start, board-only included (`src/main/main-setup.ts:196`,
  `src/main/tray-setup.ts`). Its menu ("Show app", "Quit") belongs to Persephone, not to the board.
- **Update notices.** `checkForUpdates()` runs 5 s after every start (except under a profile).
  `broadcastUpdateAvailable()` then records `lastNotifiedVersion` *before* anyone has necessarily
  seen the notice (`src/main/version-service.ts`). A board-only session can therefore use up the
  notice without showing it.
- **No CLI.** Shortcuts, board creation and trust are reachable only from inside Persephone or over
  MCP. An agent that has just installed Persephone has neither.
- **No PATH entry.** The installer does not add a command to PATH. Adding the install folder itself
  would expose `persephone.exe` (Electron) rather than the launcher.
- **Not on any package manager.**
- **Unsigned binaries.** Not required by winget, but SmartScreen and Defender treat unsigned
  installers with more suspicion. The backlog already has a SignPath Foundation item
  (`doc/tasks/backlog.md`, "Code signing").

## Design decisions (2026-11-06, proposed — the user delegates; reasons recorded)

1. **winget first, Scoop second, Chocolatey not now.**
   - winget ships with Windows 10/11, so agents already know it.
   - Scoop uses the portable zip and adds PATH shims for free.
   - Chocolatey's manual moderation queue costs a lot of release work for little reach.
2. **Package updates are automated on release publish.** A workflow triggered by
   `release: published` submits the winget manifest pull request. This fits the existing release
   process: the trigger is the user's manual publish in step 7, so no package goes out before the
   user approves the release.
3. **The CLI is the launcher, exposed from a `bin` folder.**
   - The installer adds `<install>\bin` (not the install root) to the **user** PATH.
   - `bin` holds `persephone.exe`, a copy of `persephone-launcher.exe`, so `persephone` on PATH is
     the launcher and never Electron directly.
   - The uninstaller removes the PATH entry.
   - The task document must check whether the launcher can find Electron from `bin` (one folder
     down) or needs a path argument.
4. **Subcommands run in Electron main, which owns the logic.**
   - The launcher passes `board …` subcommands through the pipe, or starts Electron if needed.
     Main reuses the code that already exists: board identity and icon, `writeShortcutLink`, and
     the board template.
   - Main runs the command without opening a window and quits afterwards if nothing else is open.
   - Command set (first cut):
     - `persephone board new <folder> [--name <name>]`: create a board from the bundled template.
       Its manifest has every permission off, as `boards.createBoard` does.
     - `persephone board open <folder>`: the same as `--board`.
     - `persephone board shortcut <folder> [--desktop | --path <file.lnk>] [--overwrite]`
   - The existing argument forms (`--board`, file paths, `diff`) keep working unchanged.
5. **The CLI reports results to the console.**
   - An agent needs an exit code and readable output.
   - The launcher is a windowed-subsystem exe, so for subcommands it must attach to the parent
     console (`AttachConsole(ATTACH_PARENT_PROCESS)`), or a console-subsystem shim is needed. The
     task document chooses one.
   - The launcher waits for main's reply on the pipe and prints it.
   - Exit codes: 0 success, 1 usage error, 2 failure (message on stderr).
6. **`board shortcut` works for untrusted boards from the CLI.**
   - This differs from the MCP `boards.createShortcut`, which refuses untrusted boards.
   - The CLI case is "the agent built this board for the user". Launching an untrusted board
     already shows the trust dialog in its window (EPIC-136 decision 11), so a shortcut grants
     nothing.
   - The MCP restriction stays as it is. Revisit it only if the user wants the two to match.
7. **Board host mode = "no normal window has been shown in this process".**
   - No tray icon while only board windows exist. The tray is created the first time a normal
     window opens, and stays after that.
   - The update check still runs. Its notice is held back until a normal window exists, and
     `lastNotifiedVersion` is recorded only when the notice is actually shown.
   - Nothing else Persephone-branded appears: first-run screens, What's New, toasts addressed to
     the app. The task document lists each such surface it finds.
   - Services used by the board (board protocol, module services, MCP endpoint) start as they do
     now. Pipe and MCP stay up so agents can still reach the board.
8. **The agent guide lives on the public site, with an `llms.txt`.**
   - One page on andriy-viyatyk.github.io: install command, board folder format (pointing to the
     existing board-authoring guide), CLI commands, the trust-on-first-launch step, and what to
     tell the user.
   - The in-app `guides.agents.boards` gets a short CLI section so agents that already have MCP
     learn it too.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1778 | `persephone` command on PATH, with `board new / open / shortcut` | Planned |
| US-1779 | Board host mode: no tray or app notices in board-only sessions | Planned |
| US-1780 | Publish to winget, automated on release publish | Planned |
| US-1781 | Scoop bucket for the portable zip | Planned |
| US-1782 | Agent guide on the site (`/persephone/agent-tools/` + `llms.txt`) | Planned |

**Order:** US-1779 and US-1778 are independent and can go first, in either order. Then US-1780 and
US-1781. US-1782 goes last, because it documents the real commands and package IDs.

Why packaging comes after the CLI: the winget manifest declares the installer's behaviour,
including the PATH entry. Publishing first and changing the installer later means a second round of
validation.

### Scope notes

- **US-1778 (CLI):**
  - Launcher (`launcher/src/main.rs`): subcommand parsing, a console attach, and a request/reply
    exchange on the pipe. Today the pipe is fire-and-forget.
  - Main: a command handler that runs without a window and quits when idle.
  - Installer: the `bin` folder, user PATH add/remove in `build/installer.nsh`, and the same in
    silent mode.
  - Reuse `boards.createBoard`'s template and `board-window-identity.ts` rather than duplicating
    them.
  - Check the dev-build case: `getBoardLauncherPath()` targets the installed launcher.
- **US-1779 (host mode):**
  - Defer `setupTray()` until the first normal window exists.
  - Fix the `lastNotifiedVersion` ordering in `version-service.ts`.
  - Audit every startup surface that shows Persephone UI, and check what board windows do with
    `broadcastUpdateAvailable` today.
  - Measure board-only cold start (shortcut double-click to board visible) and record the number in
    the task document. If it is poor, open a follow-up task rather than widening this one.
- **US-1780 (winget):**
  - Package ID `AndriyViyatyk.Persephone`; installer type `nullsoft`.
  - Silent switches, with the per-user scope confirmed working in silent mode and the NSIS
    "Choose Users" page skipped.
  - First manifest submitted with `wingetcreate`, then a `release: published` workflow (e.g.
    `vedantmgoyal9/winget-releaser`) using a fine-grained token stored as a repository secret.
  - Update `doc/standards/release-process.md`: what to check after publishing.
  - Persephone's own update notice stays. winget users can upgrade either way.
- **US-1781 (Scoop):**
  - A bucket repository (`andriy-viyatyk/scoop-persephone`) with a manifest for the portable zip,
    `bin` shim → `bin\persephone.exe`, `checkver`/`autoupdate` against GitHub releases.
  - Confirm where the portable build stores user data, so `scoop update` does not lose it.
- **US-1782 (guide):** a site page plus `llms.txt` at the site root, a short CLI section in
  `assets/guides/agents/boards.md`, and a link from the Boards page.

## Concerns

- **Persephone becomes a hidden dependency.** Uninstalling "persephone" from Apps breaks every
  tool an agent built on it. The guide should tell agents to tell the user this when they hand
  over a tool.
- **One shared process.** All boards, and Persephone itself if the user opens it, run in one
  process. A crash in one takes down the others. This is accepted, as in EPIC-136.
- **Code signing.** It isn't required, but the first impression ("Windows protected your PC") is
  exactly what this epic wants to avoid. Doing the SignPath backlog item first or alongside would
  help.
- **Sandboxed agents.** Some agents cannot launch GUI programs, as Codex cannot launch Persephone
  here. `board new` and `board shortcut` must therefore work without showing any window, and
  `board open` is optional for agents.
- **winget validation.** Microsoft's pipeline runs the silent installer and scans it. The custom
  `installer.nsh` (language page, file associations, upgrade path) must behave in silent mode with
  no leftover prompts.

## Notes

### 2026-11-06
- The idea came from the user: agents install Persephone as a runtime and build user tools as
  boards that the user launches from the desktop without knowing Persephone is underneath.
- Most of the runtime side already exists from EPIC-136. This epic is about distribution, a CLI,
  and hiding the remaining app surfaces.
