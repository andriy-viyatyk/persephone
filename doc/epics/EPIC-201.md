# EPIC-201: Board data and network isolation

## Status

**Status:** Active (started 2026-11-19)
**Created:** 2026-11-18

## Overview

Three published boards could not be tested at all, because opening them reaches outside the Persephone profile or
onto the network without saying so. That is a test problem, and also a transparency problem for users and agents:
neither `network: false` in a manifest nor a separate Persephone profile means what a reader would expect. Found in
EPIC-193 to EPIC-195 (see [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)).

This needs design work on both sides: Persephone (what a board service gets from the host) and `persephone-boards`
(the boards that use it).

## Findings

| Board | Reaches outside on open | Evidence |
|---|---|---|
| Translate | Fetches the model registry from `firefox.settings.services.mozilla.com`, even with nothing downloaded. Its data root is the real `%LOCALAPPDATA%\Persephone\board-data\translate`, not the profile. | `scripts/service.mjs:206-207`, `scripts/translation-assets.mjs:29-32,147-172` |
| Agent Chat (claude-agent) | Lists the user's real `~/.claude/projects` sessions; resolves the real `claude` / `codex` CLIs from `PATH`; keeps data in the real `%LOCALAPPDATA%`. A test instance inherits the user's environment. | `app.js:1617`, `scripts/providers/claude.mjs:290`, `scripts/claude-executable.mjs:15`, `scripts/providers/codex.mjs:55`, `scripts/service.mjs:31-33,159-161` |
| Torrent Viewer | "Metadata only" still starts WebTorrent DHT discovery. The manifest's `network: false` covers only `persephone.fetch()`, not the board's Node service. | `scripts/service.mjs:103-112` |

## Goals

- **Board data roots follow the profile.** A board service gets its data root from the host's board storage
  location, so a named profile or a test profile isolates it. No board computes `%LOCALAPPDATA%\Persephone\…` itself.
- **Manifests are honest about the network.** Either `network: false` also covers a board's service, or the
  permissions guide says plainly that it does not. Boards that contact a server when they open say so in their
  README.
- **Torrent Viewer can be used offline.** An "inspect metadata" mode (`dht: false`, no trackers) lets a `.torrent`
  be inspected without joining the swarm, and makes the board testable.
- **The test suite can run a board service in a sandbox.** In test mode, a board process sees `USERPROFILE`,
  `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `PATH` redirected into the test profile, so Agent Chat's
  offline states (its UI, settings, the "no CLI" error) can be covered.

## Decisions (2026-11-19)

Taken by Claude at epic start; the user delegates these choices.

1. **The data root is a service environment variable, `PERSEPHONE_BOARD_DATA`.** The host sets it to the absolute
   path of the board's own data folder, `<board data root>/<board id>`, next to `PERSEPHONE_BOARD_ROOT` and
   `PERSEPHONE_LOCALE`. The host does not create the folder; the board does, on first write.
   - *Why:* only the Node side (services, and the processes a board starts) keeps large data such as models,
     runtimes and enrollments. The frame already has `persephone.storage`. An environment variable follows the
     `PERSEPHONE_LOCALE` precedent, adds no protocol code, and does not change `window.persephone`, so there is
     no `BOARD_BRIDGE_VERSION` bump. A board falls back to the old `%LOCALAPPDATA%` path when the variable is
     missing (an older Persephone), so no `minAppVersion` bump is needed either.
   - *Board id:* the name the boards already use for their folder (`translate`, `claude-agent`, ...), so the
     default profile keeps today's paths. The plan names the existing helper that derives a board's id.
2. **Where the board data root lives.** Default profile: `%LOCALAPPDATA%\Persephone\board-data`, the path the
   boards use today. Named profile (`--profile`, with or without `--profile-dir`) and test instances:
   `<userData>\board-data`, inside the profile's own folder.
   - *Why:* everything a named or test profile owns stays in one folder, so deleting the profile deletes its
     board data, and a `--profile-dir` profile stays self-contained. The default profile is unchanged.
3. **No migration.** The default profile's path does not move, so its data needs nothing. A named profile starts
   with an empty board data root and downloads models again. Boards neither copy nor read the old shared
   folder. Nothing is ever deleted.
   - *Why:* isolation is the point of a named profile; silently copying gigabytes of models into it is worse
     than one explicit download. The guide tells a user they can copy a board's folder by hand.
4. **Document, do not enforce, `network: false` for services.** `network` governs the frame's
   `persephone.fetch()` only. A board service is an ordinary Node process with the user's file and network
   access; blocking `net`/`http` inside it is easy to bypass (child processes, workers, native addons), so it
   would be a false promise. Instead: the permissions guide says so plainly, the trust dialog's service line says
   so, and a board that contacts a server when it opens says so in its README.
   - Boards should also stop going online on open where the network is not needed: Translate fetches the model
     registry only when the user asks for it (models dialog, download), and Torrent Viewer gains an offline
     inspect mode.
5. **Test-mode sandbox applies to board processes only.** In a test instance, a board's service and the
   processes a board starts see `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`
   and `PATH` redirected into the test profile. `PATH` keeps only the Windows system folders plus a profile
   folder, so user-installed CLIs (`claude`, `codex`) are not found. The main process and app-level processes
   (terminal, `proc`, git) keep the real environment, because their tests need `git` and `node` on `PATH`.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-2132](../tasks/US-2132-board-data-root/README.md) | Host: hand a profile-scoped data root to board services | Implemented |
| [US-2133](../tasks/US-2133-boards-use-data-root/README.md) | Boards: Translate, Agent Chat and the speech boards use the host data root | Implemented |
| [US-2134](../tasks/US-2134-network-honesty/README.md) | Network honesty: `network: false` and services (guide, trust dialog, READMEs) | Implemented |
| [US-2135](../tasks/US-2135-torrent-offline-inspect/README.md) | Torrent Viewer: offline metadata mode | Implemented |
| [US-2136](../tasks/US-2136-test-board-sandbox/README.md) | Test mode: environment sandbox for board processes, then cover Translate / Agent Chat / Torrent offline states | Implemented |

## Notes

- **New English UI text** goes into the Persephone catalog untranslated; list it here for the epic's completion.
  - `board.permissionProcessAccessDetail` (`src/shared/i18n/en/board.ts`, US-2134): translate into every pack at completion.
- **Board versions:** Translate, Agent Chat and Torrent Viewer were not bumped by EPIC-200, so each gets a new version.
  Wake Word was bumped by EPIC-200 and is still unpublished: add to its existing `WHATS-NEW.md` heading, do not bump
  again.
- **EPIC-200 carry-over:** Agent Chat agent-guide result examples, added in US-2133 and checked live once US-2136
  makes the board testable.
- **Implementation notes (2026-11-19):**
  - US-2136: the sandboxed `PATH` would have broken board fixtures that run `node <script>` through `persephone.execute()`, so
    `test-bin` holds a `node.cmd` that forwards to the host's `node.exe` by absolute path (only `node`; the folder holding it may
    also hold npm-global CLIs). The sandbox also removes `CLAUDECODE` / `CLAUDE_CODE_*`, which an agent CLI that launched the suite
    leaves behind (its executable path and messaging token), and finds `SystemRoot` case-insensitively.
  - US-2136 found a board bug: with no SDK installed, Agent Chat's start flow stopped at the SDK consent gate before checking for a
    CLI, so the "no CLI" message never appeared. Fixed in Agent Chat 1.5.1 (`cliAvailable` in the provider description).
  - US-2135: joining the swarm after an offline inspection adds the original `.torrent` bytes, not the magnet, so the swarm does
    not have to supply metadata the user's file already holds.
  - Agent Chat agent-guide examples (EPIC-200 carry-over) are source-derived. The test sandbox lets the board open and its no-CLI
    state be tested, but `send`/`messages`/`waitIdle` need a signed-in CLI, so those examples were not exercised live.
