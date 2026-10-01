# EPIC-119: Board permissions — least privilege, declared in the manifest

## Status

**Status:** Planned (starts after EPIC-118)
**Created:** 2026-10-02
**Completed:** —

## Overview

Today a trusted board can do anything: run commands, read and write any file, open external
programs, script the app. The manifest `permissions` array is disclosure only, except for
`"service"`. This epic makes permissions **enforced**: every capability is off unless the board's
manifest enables it, the bridge refuses the rest, and the trust dialog shows the user exactly what
the board is allowed to do.

The case it handles: a catalog viewer board (Word, Excel, PowerPoint, PDF, draw.io) renders a
hostile document. One HTML-injection bug in that viewer runs script with the board's full bridge,
so opening a crafted file runs commands on the machine. A viewer that enables nothing dangerous
turns that bug into a defaced viewer page instead (EPIC-118 finding F7, moved here).

## Decisions

- **2026-10-02 (user): permissions are enforced, not disclosure.** This reverses the earlier
  rule that a trusted board is unrestricted and `permissions` only discloses. Trust stays the
  gate for running a board at all; the manifest now also bounds what it can do once trusted.
- **Off by default.** The scaffolded `board-manifest.json` lists every flag as `false`; the
  board author (usually an agent) enables what the board uses.
- **Manifest shape:** an object of flags, for example
  `"permissions": { "execute": false, "fileSystem": "board", "openExternal": false, "camera": false }`.
  The old array form is still read.
- **Existing boards keep working.** A manifest with no permissions object (or the old array) gets
  full access and is labelled **Unrestricted** in the trust dialog and Board Info. Nothing breaks
  on upgrade.
- **Clear refusals.** A denied call rejects with
  `permission-denied: "execute" is not enabled in board-manifest.json`, so an agent can fix the
  manifest itself.
- **Re-trust on change.** If a trusted board's permissions change, it asks for trust again,
  showing the new list.
- **Complete or pointless.** Every bridge path that reaches the system must be covered by a flag.
  One ungated path, such as `writeFile` to any location, lets injected script drop a file in the
  Startup folder and undoes the rest. US-1593 inventories the whole surface first.
- Any bridge behavior change bumps `BOARD_BRIDGE_VERSION`.
- **Old Persephone builds and the new manifest (verified 2026-10-02).** Today
  `normalizeStringList` (`src/shared/board-manifest-utils.ts:13`) returns `[]` for anything that
  is not an array. An old build reading the new object form therefore loses `"service"`, and the
  board's service refuses to start. So a board that adopts the object form also sets
  `minBridgeVersion` to the new bridge version. Old builds then show their existing "needs a newer
  Persephone" state instead of half-working.
- **Every board is migrated in this epic** — the catalog in `persephone-boards` (republished) and
  the user's own registered boards (US-1601) — so nothing the user runs stays "Unrestricted".

## Permission set (draft — finalized in US-1593)

| Flag | Gates |
|---|---|
| `execute` | `execute()`, `executeNode()` |
| `service` | Board background service (already enforced) |
| `fileSystem` | `false`, `"board"` (board folder + files the user picks), or `"full"` (any path) |
| `openExternal` | Launching URLs and files through the shell |
| `appScripting` | Persephone scripts, agent tools, opening or changing other pages |
| `camera`, `microphone`, `geolocation`, `notifications` | Device access for the board frame |

## Linked Tasks

Task documents are written when each task starts.

| Task | Title | Status |
|------|-------|--------|
| US-1593 | Permission model: bridge surface inventory, manifest schema, enforcement for `execute` / `openExternal` / `appScripting` / `service` | Planned |
| US-1596 | Scoped file access (`fileSystem: false / "board" / "full"`, user-picked files) | Planned |
| US-1597 | Device permissions for board frames (camera, microphone, geolocation, notifications) | Planned |
| US-1598 | Trust dialog and Board Info: show granted permissions, "Unrestricted" label, re-trust on change | Planned |
| US-1599 | Scaffold all-`false` manifest; board guides and agent instructions | Planned |
| US-1600 | `persephone-boards` catalog: minimal permissions per board, `minBridgeVersion`, viewers render documents safely; republish all boards | Planned |
| US-1601 | Migrate the user's registered custom boards: a Codex run per board works out what it uses and writes its permissions | Planned |

### Task scope notes

- **US-1593:** Inventory every bridge method (`src/main/board-bridge.ts`, the renderer side of the
  board bridge, board services in `module-service-supervisor.ts`) and assign each to a flag or mark
  it harmless. Define the schema in `src/shared/board-manifest-utils.ts` (`normalizePermissions`
  today returns a string list). Enforce in main, not in the board page.
- **US-1596:** "User-picked files" means paths returned by the board's own open/save dialogs in
  this session. Decide whether `"board"` includes the board's data folder.
- **US-1597:** Board frames load `board://<host>` in the app session; `permission-policy-service.ts`
  allows only `APP_ALLOW` there today. Grant a device permission when the requesting origin is a
  board whose manifest enables it; the iframe `allow` attribute in `BoardWebview.ts` must list it too.
- **US-1598:** `TrustBoardDialogView.ts` already prints `Permissions: …`; replace it with a readable
  list. Trust records must store the granted set to detect a change.
- **US-1599:** `assets/board-template/board-manifest.json` gets every flag as `false`. Rewrite
  the "permissions are disclosure, not a gate" passages in `assets/guides/agents/boards.md` and
  `assets/board-template/CLAUDE.md`, and tell the agent to enable only what the board uses.
  `assets/guides/agents/board-review.md` checks that the declared set matches the code.
- **US-1600:** Repo `C:\projects\persephone-boards` (`boards/`, `boards-manifest.json`). Per board:
  find the bridge calls it makes, write the minimal permissions object, set `minBridgeVersion`.
  Viewer boards also get the audit from EPIC-118 F7: insert converted document HTML only after
  sanitizing (DOMPurify) or inside a sandboxed iframe without the bridge. Publish after the
  Persephone release that enforces permissions, so the catalog never offers a board the shipped
  app cannot run.
- **US-1601:** The registered boards are listed in `trustedBoards.txt` in the data folder
  (`board-trust-service.ts:164`). One Codex run per board, with that board's folder as its working
  root (`-C <folder>`), so a run can only write inside the board it migrates. Each run reports the
  calls it found and the permissions it set; a board whose needs are unclear is reported, not
  guessed. Each board then shows the re-trust dialog once, which is expected. Commit or back up a
  board before its run if it is not under git.
