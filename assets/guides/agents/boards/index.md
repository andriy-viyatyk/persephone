---
title: "Boards — build a custom board/editor for the user"
audience: agent
summary: "Boards authoring hub: what a board is, create and open one, the starter files, and which page to read for permissions, settings, toolbar, bridge, services, files, testing and folder editors."
---

# Boards — build a custom board/editor for the user
A **Board** is a small, self-contained web app you (the agent) build for the user:
a dashboard, tool, viewer, or custom editor. Persephone hosts it in a locked-down,
cross-origin `<iframe>` and gives it a single bridge object, `window.persephone`. You drive the
whole loop through the live object model with `call`: scaffold it with `boards.createBoard`, open
it with `boards.openBoard`, then inspect and test the running page through `pages[i].editor` —
no user clicks required. Use `script.execute` only for what no call path covers.

Check `persephone.version` before using a bridge member that may not exist in an older app; each bridge release is listed in <!-- board-template:exclude -->[bridge version history](bridge-versions.md)<!-- /board-template:exclude -->`guides.agents.boards["bridge-versions"]`.

## Read next

This page is enough to create and open a board. For the area you are working on, read its page — each is a separate guide page.

| Read when you need to … | Page (object-model path) |
|---|---|
| declare or explain board permissions and trust (also what a feature needs in the manifest) | <!-- board-template:exclude -->[permissions](permissions.md) — <!-- /board-template:exclude -->`guides.agents.boards["permissions"]` |
| add user-editable board settings | <!-- board-template:exclude -->[settings](settings.md) — <!-- /board-template:exclude -->`guides.agents.boards["settings"]` |
| add toolbar buttons, menus, breadcrumbs, the footer, or `.p-*` styling | <!-- board-template:exclude -->[toolbar-and-footer](toolbar-and-footer.md) — <!-- /board-template:exclude -->`guides.agents.boards["toolbar-and-footer"]` |
| run backend scripts, use the themes bridge, page visibility, page-scoped state, long-running processes | <!-- board-template:exclude -->[bridge](bridge.md) — <!-- /board-template:exclude -->`guides.agents.boards["bridge"]` |
| open pages, files or boards, show dialogs, send notifications, return from a third-party site | <!-- board-template:exclude -->[integration-tier](integration-tier.md) — <!-- /board-template:exclude -->`guides.agents.boards["integration-tier"]` |
| read/write files and folders, watch changes, call the app (`persephone.call`) | <!-- board-template:exclude -->[files-and-app-access](files-and-app-access.md) — <!-- /board-template:exclude -->`guides.agents.boards["files-and-app-access"]` |
| run a board service, shared storage, content providers, download URL claims | <!-- board-template:exclude -->[services](services.md) — <!-- /board-template:exclude -->`guides.agents.boards["services"]` |
| provide or consume capabilities and intents | <!-- board-template:exclude -->[capability-handlers](capability-handlers.md) — <!-- /board-template:exclude -->`guides.agents.boards["capability-handlers"]` |
| make a board the editor for a folder, claim a folder, or navigate a file in its own page | <!-- board-template:exclude -->[folder-editor](folder-editor.md) — <!-- /board-template:exclude -->`guides.agents.boards["folder-editor"]` |
| keep a board's secrets or API keys outside its folder (env vars, `persephone.var`) | <!-- board-template:exclude -->[languages-and-env](languages-and-env.md) — <!-- /board-template:exclude -->`guides.agents.boards["languages-and-env"]` |
| make a board translatable (language packs) | <!-- board-template:exclude -->[languages-and-env](languages-and-env.md) — <!-- /board-template:exclude -->`guides.agents.boards["languages-and-env"]` |
| handle unsaved changes, tab mute, secondary views | <!-- board-template:exclude -->[lifecycle-and-ui](lifecycle-and-ui.md) — <!-- /board-template:exclude -->`guides.agents.boards["lifecycle-and-ui"]` |
| match Persephone's theme; vendor libraries offline; manifest, icon, reload | <!-- board-template:exclude -->[theme-and-assets](theme-and-assets.md) — <!-- /board-template:exclude -->`guides.agents.boards["theme-and-assets"]` |
| trust, rename or install published boards; review a board | <!-- board-template:exclude -->[published-boards](published-boards.md) — <!-- /board-template:exclude -->`guides.agents.boards["published-boards"]` |
| ship a board's own `guides` folder | <!-- board-template:exclude -->[own-documentation](own-documentation.md) — <!-- /board-template:exclude -->`guides.agents.boards["own-documentation"]` |
| find which bridge version added a member; `minBridgeVersion` | <!-- board-template:exclude -->[bridge-versions](bridge-versions.md) — <!-- /board-template:exclude -->`guides.agents.boards["bridge-versions"]` |
| test a board, read the error log, see the Demo board | <!-- board-template:exclude -->[testing](testing.md) — <!-- /board-template:exclude -->`guides.agents.boards["testing"]` |

## What a board is

- **Frontend** — `index.html` + `app.js` (+ any CSS/assets). Owns *all* UI and *all* state;
  this is what renders in the iframe.
- **Backend** — scripts under `scripts/` (`.js`, `.py`, `.ps1`, `.sh`, …). They run as real OS
  processes with the user's privileges and talk to the page over stdout. A `.js` script runs
  under **plain Node.js** — no Electron or renderer globals (e.g. `process.versions.electron` is
  undefined).
- **Channel** — `persephone.execute(commandLine)`: the page runs a script, the script prints
  JSON to stdout, the page parses it and renders. That's the whole loop.

Persephone owns no board state and no board UI — it wires the channel and shows the page.
A folder is recognized as a board because it contains **`board-manifest.json`** (schema
version + optional descriptive metadata; it never controls behavior and is **not** a trust
source — trust is a user decision held outside the board).

## Create & open a board

Inspect `boards.$help` for the concise live lifecycle. A board you create is **auto-trusted at
creation**, so it opens with no prompt; the details below are the authoring and format reference.

1. **`boards.createBoard(name, dir)` / `boards.createDemoBoard(name, dir)`** — scaffold a board
   (blank or the bundled Demo template). `name` is the board folder name; `dir` is the **container folder** it's
   created inside (created if missing). Returns **`{ boardRoot }`** — the new board's absolute
   root path. A name collision errors.
2. **`boards.openBoard(boardRoot)`** — open the board (`boardRoot` from step 1). Opens a
   **new tab** (or reuses the board's existing tab) and makes it the active page.

Then confirm with `call` at `pages` and read the board page's `pageId` for
`pages[pageId].editor` testing (see below). Opening a board you did **not** create (a foreign folder) shows
a trust prompt; a board you created never does. A later permission increase on your own board
shows the permissions-changed dialog, which you answer yourself (see "Who answers the trust
dialogs").

> These are ordinary `call` paths on the `boards` namespace — drive the lifecycle with `call`, not
> with `script.execute`. (`persephone.openRawLink(href, options?)` is a generic opener for files,
> URLs and in-app links; `{ inPlace: true }` can navigate the board's own page. See the
> <!-- board-template:exclude -->[folder editor guide](folder-editor.md)<!-- /board-template:exclude -->`guides.agents.boards["folder-editor"]`.)

The `boards` namespace also exposes shortcut and window operations:

- **`boards.createShortcut(boardRoot, opts?)`**
  -> `Promise<{ linkPath: string } | null>`: create a Windows `.lnk` that launches the board in
  its board-mode window. The root must be absolute, contain `board-manifest.json`, and be trusted
  or bundled; an untrusted board is rejected with guidance to call `boards.registerBoard(root)`.
  Without `opts.linkPath`, the existing Save dialog appears and cancellation returns `null`. Pass
  an absolute `.lnk` `opts.linkPath` to skip the dialog; its parent directory must exist, and an
  existing shortcut is refused unless `opts.overwrite` is `true`. The returned `linkPath` is the
  resolved absolute destination. Failures reject to the caller without a UI notification.
- **`boards.openBoardWindow(boardRoot)`**
  -> `Promise<void>`: create a visible board-mode window or focus the existing one for that root.
  The absolute root must contain `board-manifest.json` and be trusted or bundled; this agent call
  rejects an untrusted board without opening a trust dialog. Use `boards.openBoard(root)` when the
  desired result is an ordinary tab in the current window.

These are host Object Model calls and do not add methods to the board's `persephone` bridge.

## Develop it

`boards.createBoard` scaffolds a **working starter** — build on it, don't blindly overwrite it. A
blank board contains:

- `index.html` — the page shell (a starter button + output area), linked to `board-base.css`.
- `app.js` — frontend logic with a `boardScript()` helper that calls `persephone.execute()`.
- `scripts/hello.js` — an example backend script demonstrating the `@@RESULT@@` convention.
- `board-base.css` — shared theme defaults (page bg/text, monospace font, themed scrollbars,
  themed focus ring, Persephone-style native checkboxes) plus the opt-in `.p-*` chrome
  layer (`.p-toolbar`, `.p-btn`, `.p-input`, …).
  **Already linked in `index.html`; don't fetch or recreate it.**
- `board-manifest.json` — the board-identity file (already valid).
- `lang/en.json` — the default UI messages; the starter calls `persephone.i18n.t()` to display them.
- `CLAUDE.md` — generated from this guide when a blank board is scaffolded. **When the board is
  built, rewrite this file to document _this_ board** (purpose, how it works, key files, run/test
  steps, gotchas) so a future agent has instant context — see the "rewrite this file" note at its
  top. The generic reference is always available in this resource, so it's safe to trim.

Edit these with your own file tools (or `app.fs` through `script.execute` when no call path covers it). The key
surfaces:
