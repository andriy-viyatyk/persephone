---
title: "Reviewing a board before you trust it"
audience: both
summary: "A security review checklist for a board the user did not write: what trusting it actually grants, what to read, the signals that matter, and why code fetched at runtime defeats the review."
---

# Reviewing a board before you trust it

The Trust-this-Board dialog tells the user to ask their AI agent to review the board's scripts.
This page is that review. It is written for the agent doing it; a user reading along will find
the same reasoning.

Do this whenever the user asks "can I trust this board?", whenever you are about to call
`app.boards.registerBoard(root)` on a board they did not author, and again **after an update**
(see [Re-review triggers](#re-review-triggers) — trust survives an update).

## What trust actually grants

Trust is not a permission scale — it is one switch, and it is all the way on. Review against what
the board *could* do, not what it appears to do.

**The board's own frame is locked down.** Persephone serves it under a strict CSP:
`default-src 'none'`, `connect-src 'self'`, no remote scripts or styles, and no JavaScript `eval`
(only WebAssembly compilation). So the UI you see cannot fetch remote code or call out to a server
by itself. That is worth knowing mostly because it tells you **where to spend the review**: not in
the HTML.

**Everything dangerous is on the other side of the bridge.** A trusted board can:

| Capability | What it means |
|---|---|
| `persephone.execute(command)` | Any command line, **through the OS shell by default**, with the user's full privileges and inherited environment. Working directory defaults to the board folder — it is not a boundary. |
| `persephone.executeNode(script, args)` | The board's own script on Persephone's bundled Node. Argv-style (no shell), but Node has no CSP: unrestricted filesystem and network. |
| Declared `service` / `scripts/service.mjs` | A platform-owned Node process that can run without a page; inspect its imports, storage, network, handshake, request routing, and failure behavior. |
| `persephone.readFile` / `writeFile` | **Absolute paths are accepted.** These are not scoped to the board folder; they reach anything the user can read or write. |
| `persephone.call(path, options)` | The full **renderer** Persephone object model, gated only by trust: `fs`, `proc`, `shell`, `settings`, `tools.execute`, `boardVars` (administration of stored environment variables and secrets across namespaces), and `script.execute` — arbitrary JavaScript in the renderer with Node access. It cannot reach the process-owned `main` or `windows` roots. A board never needs most of this. |
| Trust scope | Per board-root folder, remembered across restarts, and **inherited**: trusting a folder trusts every board nested inside it, including ones added later. |

So the review question is not "is the UI honest?" It is: **what can run, what does it reach, and
can it change after the user clicks Trust?**

## What to read

1. **`board-manifest.json` first.** It declares the board's identity, `permissions`,
   `minBridgeVersion`, any `service` entry, and any `contentProviders` declarations, plus (for an
   editor board) `fileMasks` / `contentMasks` / `folderMasks` and `editorKind`. These say which of
   the user's files this board
   will be handed automatically. Broad masks on a board whose stated purpose is narrow is a finding
   on its own.
2. **Every file in the folder.** `index.html`, the app scripts, **all of `scripts/`**, and anything
   in `lib/`. Boards are plain files; there is no hidden part.
3. **Then re-read the entry points**: what runs at load, on a timer, and on each user action.

## The signals that matter

Grep the folder for these, then read every hit in context. A hit is not a verdict — an honest
board may legitimately spawn a process — but every one of them needs a reason you can state.

| Search for | Why it matters |
|---|---|
| `execute(`, `executeNode(`, `service`, `scripts/service.mjs` | Every process the board can start. Read the command string or service entry. For a service, inspect the handshake, request routing, `persephone.storage` calls, crash and handshake-hang behavior, imports, network use, and `ui.log`. |
| `contentProviders`, `persephone.providers.register`, `streamUrl` | Check that provider types are namespaced, the service owns the function-valued implementation, payloads stay bounded, and a stream-host page uses the broker URL rather than a copied path. Board-provider seeking is not available yet. |
| `persephone.call(` | Check the path. `fs`, `proc`, `shell`, `script.execute`, `tools.execute`, `boardVars`, `settings` each need a purpose; `script.execute` is arbitrary code and is rarely justified. |
| `fetch(`, `http`, `https`, `axios`, `curl`, `Invoke-WebRequest`, `wget` | Where the board talks to the network — in backend scripts, where nothing blocks it. |
| `readFile(`/`writeFile(` with an absolute path, `..`, `~`, `%APPDATA%`, `$HOME` | Reaching outside the board folder. |
| `process.env`, `.env`, `.ssh`, `credentials`, `token`, `cookie`, browser-profile paths | Credential access. Dangerous in combination with any network call. |
| `eval(`, `new Function(`, `atob(`, `Buffer.from(..., "base64")`, long hex/base64 literals | Code or payloads that only become readable at runtime. In a backend script there is no CSP to stop them. |
| `child_process`, `spawn`, `exec`, `-Command`, `cmd /c` | Process execution inside a backend script, one level below `persephone.execute`. |

Declaring `service` is **not a security boundary**. `permissions` is disclosure and lifecycle
hygiene, not a privilege grant or sandbox, because trust already permits arbitrary renderer and
Node execution. Review the service as another process and supply-chain surface. For the
service-versus-`executeNode()` ownership decision, use the canonical wording in the
[board-authoring guide](../../board-template/CLAUDE.md#declared-module-services-manifestservice)
instead of creating a second rule here.

## Code that arrives after you trust it

This is the case worth being strict about, because it defeats the review itself. Everything you
read is a snapshot: it describes the board as it is on disk right now. A board that **downloads
code and runs it** is asking the user to trust something that has not been written yet — and that
can be replaced at the source, after trust is granted, without touching the user's machine in any
way they would notice.

Treat as a stop-and-report finding:

- **Pipe-to-shell**: `curl … | sh`, `iwr … | iex`, `Invoke-Expression` on fetched text.
- **Runtime package installs**: `npm install`, `npx`, `pip install`, `go run`, or any fetch of a
  dependency at run time rather than a version vendored into the folder. Even honest packages
  resolve to whatever the registry serves that day.
- **Download-then-execute**: fetching to a temp file and running it, or `node -e` / `import()` on
  content that came off the network.
- **Self-updaters**: any code that replaces the board's own files or pulls a "latest" script.
- **Remote scripts in the UI** — the frame CSP blocks these, so a `<script src="https://…">` will
  simply fail. Still report it: it tells you the author expected remote code to run.

The line to hold is simple, and it is worth stating to the user in these terms: **data may come
from the network; code must ship with the board.** A board that fetches JSON from an API is
ordinary. A board that fetches something it then executes cannot be reviewed at all.

## Vendored libraries

`lib/` is the supply-chain surface. A modified line inside a minified bundle is the classic way to
hide a payload in an otherwise reviewable board.

- Identify each library and its version, and compare against the real upstream release — file size,
  the banner comment, the published hash. A bundle that does not match any release is a finding.
- A minified file you cannot account for is not "probably fine". Say you could not verify it.
- `.wasm` binaries are opaque to reading. The CSP permits WebAssembly, so note any you cannot
  attribute to a known library.

## What runs on its own

- What executes at load, before the user does anything.
- Timers and intervals, and any long-running job (a board that calls `setBoardBusy(true)` keeps
  processes alive after its tab moves on).
- For an editor board, the file masks decide which of the user's files get handed to it
  automatically — that is content the board sees without a deliberate action.

## Command injection

A board that builds a command string out of a file name, a board setting, or anything fetched from
the network, and passes it to `persephone.execute` — which runs through the OS shell by default —
can be turned into arbitrary execution by whoever controls that input. Check that every
interpolated value is either constant or validated.

## Reporting, and the decision

Report findings with the file and line, what the code does, and why it matters — concretely enough
that the user can judge it. Then state a verdict *and its limits*: what you read, what you could
not verify, and what you would want to see changed.

**The decision is the user's, not yours.** `app.boards.registerBoard(root)` raises the trust
dialog, and the dialog is also answerable through the object model
(`dialogs[i].click("Trust Board")`). Never click it on your own judgement — a clean review is a
report, not consent. When the user *has* told you to trust the board, follow that instruction:
answering the dialog for them is carrying out their decision, not making it. If your review turned
up something that matters, say so first and let them confirm; if they confirm, proceed.

A board can never trust itself. That is the invariant the trust gate protects, and it holds
whoever clicks.

Say plainly when a board is beyond what you can verify. "I read all 400 lines and found nothing
that reaches the network or spawns a process" is a useful answer. So is "this board vendors a
2 MB minified bundle I cannot match to any published release, and it runs at load" — that is not a
failed review, it is the finding.

## Re-review triggers

- **An update.** A board update runs under the board's **existing** trust — the folder contents
  are replaced and no dialog appears. The code the user trusted is not the code now on disk.
- **Inherited trust.** Because trusting a folder trusts every board nested inside it, a board
  placed into that folder later is trusted with no prompt. Review the folder, not just the board.
- **A board that writes to its own folder.** Legitimate for saving state; worth confirming it only
  writes data files, not code it will later run.

## The two-step install is on your side

Installing a published board for the first time is deliberately two steps: **download** puts the
folder on disk inert — nothing is trusted and nothing has run — and **register** is the trust dialog.
If the target is already installed, downloading the same board updates that folder under its
existing trust, so re-review it before relying on the updated code. So the review workflow is:

1. `const root = await app.boards.downloadPublished(id)` — or point at the folder the user names.
2. Read it, using this page.
3. Report.
4. Only then `app.boards.registerBoard(root)`, and let the user answer the dialog.
