---
title: "Boards — trust, rename and published boards"
audience: agent
summary: "Trust, forget and rename a board from script, discover/install/update published boards, and review a board before trusting it."
---

# Boards — trust, rename and published boards

### Trust, forget & rename a board

Three `app.boards` calls manage an **existing** board's lifecycle — for boards you did not
create (a folder the user points you at, or one you downloaded for review):

- **`boards.registerBoard(boardRoot)`** → `Promise<boolean>` — trust a board so it renders
  and runs. Shows a trust dialog — trust is never granted without that click. For a board you
  did not write, the decision behind it is the user's, never yours. Returns `true` if trusted (or already trusted),
  `false` if the user declines. Typical review flow: read the board's scripts/HTML, report to the
  user, then call this and let them answer the dialog.
- **`boards.unregisterBoard(boardRoot)`** → `Promise<void>` — untrust the board and remove
  its category membership. No dialog (it only reduces privilege): open board pages are released,
  the service is stopped, and pages with no other editor close. A page with another editor stays open.
- **`boards.renameBoard(boardRoot, newName)`** → `Promise<string>` — rename the board's
  folder within its parent, carrying trust, category membership and its position, and any
  catalog-install registration to the new path with **no dialog**. It stops the service and
  re-points open board pages. Returns the new root. Throws if the board is running (busy), is
  not a board, or the new name already exists. This solves "rename my board" as a single action with zero user clicks.

## Published boards — discover, install, update

Persephone ships against a curated **published-boards catalog** (a GitHub repo). Six `app.boards`
calls drive the whole lifecycle so you can do "find me a drawio viewer and install it" end-to-end
with **at most one user click per privilege-granting step**. Boards install into
`<userData>/data/boards/<id>` by default. Downloading a board **trusts nothing** — the code sits
inert on disk; only `registerBoard` (a user trust-dialog click) activates it.

- **`boards.searchPublished(query?)`** → `Promise<PublishedBoardResult[]>` — the catalog,
  filtered by a case-insensitive `query` over name/description/file-masks (omit for all), each
  result annotated with `installed`, `installedVersion`, `updateAvailable`, `compatible`, `size`.
  **Read-only, no dialog.**
- **`boards.getPublishedVersions(id)`** → `Promise<PublishedVersionResult[]>` — a board's
  version history, newest first, each flagged `compatible` (vs this app) and `installed`.
  **Read-only, no dialog.**
- **`boards.downloadPublished(id, { dir?, version? })`** → `Promise<string>` — download +
  sha256-verify + extract to disk and record it, **no dialog** and **without trusting**. Returns
  the local root. This is your **"can I trust this board?" entry point** — download, read the
  files, report, then let the user decide at `registerBoard`. Throws on an unknown id/version or
  an incompatible version.
- **`boards.installPublished(id, { dir?, version? })`** → `Promise<string | undefined>` — the
  interactive combo. For a not-yet-installed board it opens the **Board Info page** prefilled and
  the user walks Download → Register (the trust dialog is the consent); resolves the root once
  registered, or `undefined` if they close the page first. For an **already-installed** board with
  a `version`, it performs an update/rollback swap **with no dialog** (subject only to a
  close-pages prompt if the board is open); resolves the root, or `undefined` if the user vetoes
  that prompt. (A *fresh* install always installs the latest; for a specific fresh version use
  `downloadPublished(id, { version })` + `registerBoard(root)`.)
- **`boards.uninstallBoard(id)`** → `Promise<boolean>` — shows the **delete confirmation**,
  then releases open board pages, stops the service, and removes the board folder, trust, category
  membership, and install entry. Returns `true` if removed, `false` if cancelled. Throws if the
  id is not installed.
- **`boards.checkPublishedUpdates(force?)`** → `Promise<BoardUpdateInfo[]>` — refresh the
  catalog (`force: true` bypasses the periodic-check gate) and list installed boards with a
  compatible newer version. **No dialog.**

### Reviewing a board before trusting it

When the user asks *"can I trust this board?"* (or you're about to register one they didn't
author), **review it before `registerBoard`**:

1. `const root = await boards.downloadPublished(id)` (or use a folder the user points you at).
2. Read **every** file in the folder — `index.html`, `app.js`, all of `scripts/`, any bundled JS.
   The iframe CSP blocks remote network from the board page; trusted boards can also use
   `persephone.fetch(url, init)` to make remote requests through Persephone, optionally with
   `{ tor: true }` or `{ proxy: "host:port" }`. That API sends only the supplied headers, is not
   subject to browser CORS, and returns a standard `Response`. Backend `scripts/` run as full OS
   processes with the user's privileges and are NOT sandboxed — that is where risk lives.
3. Flag: data exfiltration (unexpected network hosts / uploads), credential or filesystem access
   beyond the board's stated purpose, destructive `persephone.execute` usage (deletes, overwrites,
   shelling out to dangerous commands), obfuscated/minified logic that hides intent, and above all
   **anything that downloads code and runs it** — that is code the user has not seen and which can
   change after they trust it.
4. Report your findings to the user, then call `boards.registerBoard(root)` — the trust
   decision is theirs. Never trust a board on your own judgement; when they have asked for it to be
   trusted, answering the dialog carries out their decision.

The full checklist — what trust actually grants, what to grep for and why, vendored-library
supply chain, command injection, and when to re-review (an update keeps the board's existing
trust) — is <!-- board-template:exclude -->[Reviewing a board before you trust it](../board-review.md)<!-- /board-template:exclude -->,
`guides.agents["board-review"]`.

These members are `call` paths on `boards.*`; read `boards.$help` for the live signatures and cautions.
