---
title: "Boards — trust and permissions"
audience: both
summary: "The board trust gate, the board-manifest.json minBridgeVersion and permissions object, what each permission grants, network and file access."
---

# Boards — trust and permissions

## Board trust gate

**Each board must be trusted before it renders or runs.** Trust is the first gate; the board's `permissions` in `board-manifest.json` are a second gate that limits what its bridge can do. The Trust board dialog lists the permissions the board requests in plain language. Permissions marked **Full access** can reach everything your user account can. A board with every permission off can still show its own pages, work with the document opened in it, copy to the clipboard, and open links inside Persephone.

- **Boards you create** (via **"New board"**, `app.boards.createBoard()`, or the `boards.createBoard` call path) are **auto-trusted immediately** — no prompt appears.
- **Foreign boards** (any board Persephone did not create for you) show a **Trust board** dialog on first open:

  The dialog lists the board's requested permissions, one per line with a check mark, before you decide. Review the list carefully; **Run programs and scripts**, **App scripting**, and unrestricted file or network access are marked **Full access**. Only trust boards you created or fully understand. If you're not sure about a board, ask your AI agent to review its scripts before trusting it.

- **Trust is per exact board root**, remembered across app restarts together with the permissions you granted. Trusting a parent folder does not trust boards inside it; each board must pass its own trust gate. Once trusted, you are not prompted again unless the board asks for new or broader permissions (see below). Trust is stored in `%AppData%\persephone\data\trustedBoards.json`.
- **Permission changes need your decision.** If a trusted board adds a permission or raises its access level, the next open or reload shows a **Board permissions changed** dialog. It lists every permission once: a check for kept permissions, **+** for added ones, and a struck-through **−** for removed ones. Choose **Accept** to grant the new set, or **Unregister board** to untrust it (a board installed from the catalog is uninstalled, after a confirmation). Closing the dialog decides nothing: the board is taken off its page (a page left empty closes) and the dialog appears again the next time you open it. Reducing permissions takes effect without a prompt. Updating an installed board does not itself ask again unless its declared permissions change.

Changing a legacy board to an object-form permissions set also asks for trust once, even if the new
set is narrower than the old unrestricted access.

Boards whose manifest has no permissions declaration, or uses the old list format, are **Unrestricted** for compatibility and retain broad legacy access. These boards are deprecated and will stop working in a future Persephone release. The first-trust dialog explains this; opening an already-trusted affected board shows a persistent warning toast. Ask the agent that built the board to add a `permissions` object.

> Only trust boards you created or fully understand. The dialog's permission list shows what bridge access you are granting; review any **Full access** entry carefully.

**How to have it reviewed:** [Reviewing a board before you trust it](../agents/board-review.md) is the checklist to hand your AI agent — what trusting actually grants, what to look for in the board's scripts, and why a board that downloads code and runs it cannot be reviewed at all.

## Service declarations in `board-manifest.json`

Boards may declare `minBridgeVersion`, an object-form `permissions` set, and a board-relative `service` entry:

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": {
    "execute": false,
    "service": true,
    "fileSystem": false,
    "openExternal": false,
    "appScripting": false,
    "network": false,
    "clipboardRead": false,
    "camera": false,
    "microphone": false,
    "computerAudio": false,
    "geolocation": false,
    "notifications": false,
    "themes": false
  },
  "service": "scripts/service.mjs"
}
```

The minimum bridge is a compatibility requirement. The permissions object is enforced: each enabled
flag is a grant, and every omitted or false flag is denied. `fileSystem` can be `false`, `"board"`
(the board folder and files selected in its dialogs), or `"full"` (any file you can access).
`network` can be `false`, `"internet"` (public internet addresses), or `"full"` (also this computer
and the local network). A board can read the exact document currently opened in its simple editor
with `fileSystem: false`; this does not allow it to read another path or write files. Its own
`board://` assets remain available. Use object-form permissions and set `minBridgeVersion` to at
least `1.30.0`. A declared service is shown in Board Info and in the live
`app.boards.list()` status payload.

These grants control host APIs exposed to the board frame; they are not an OS sandbox for processes.
A declared service runs in a Node utility process, and `execute`/`executeNode` start ordinary Node/OS
processes. Those processes can access your files and network under your user account even when the
manifest sets `fileSystem: false` and `network: false`. In particular, `network: false` does not mean
the board's service is offline, and `fileSystem: false` does not block direct Node file access.

With `network: "internet"`, Persephone checks every address returned by DNS and connects only to
those checked addresses. A request is blocked if any answer is a local or private address, which
prevents a public hostname from being redirected to your local network through DNS rebinding.

The permission list in the trust dialog uses these meanings:

| Permission | Access it grants |
|---|---|
| `execute` | Run programs and scripts on this computer. **Full access.** |
| `service` | Run a background program while Persephone is open. **Full access.** |
| `fileSystem: "board"` / `"full"` | Read and write the board folder and files selected in its dialogs, or any file you can access. These grants also allow `openBoard()` for folders the board can list. Target-board trust remains a separate user decision. `"full"` is **Full access**. |
| `openExternal` | Open links or files in your browser or another app. |
| `appScripting` | Control Persephone, run app scripts, open and change pages, and use agent tools. **Full access.** |
| `network: "internet"` / `"full"` | Allows the frame's host-mediated remote requests through `persephone.fetch()` and HTTP(S) `content.open()`, to public internet services or also this computer and your local network. `"full"` is **Full access**. `false` denies those frame requests; it does not block a service or child process from networking. |
| `clipboardRead` | Read the contents of your clipboard. |
  | `camera`, `microphone`, `computerAudio`, `geolocation` | Use your camera or microphone, capture audio playing on your computer, or read this device's location. Computer audio capture is available on Windows and Linux. Cancellation is currently unavailable on Linux because its echo tuning has not been verified. |
| `notifications` | Show desktop notifications. |
| `themes` | Create, change, delete, and apply app themes. This does not grant `appScripting`. |

The board frame's CSP also blocks direct remote `fetch()`/XHR connections. `openExternal` is a
separate permission for launching links in the OS browser or another app; it does not control service
network access. When **Settings → Link Open Behavior** is set to the OS default browser, an HTTP(S) link opened by a
board without `openExternal` opens in Persephone's internal Browser tab instead, with an info line
in the board log. That Browser page follows its own session and network settings, not the board
frame's `persephone.fetch()` grant. Other external schemes remain blocked and show the existing
warning. Grant `openExternal` when a board needs to open links in the OS browser or another app.

`fileSystem: false` still allows a simple board to read the exact document currently open in that
board. It cannot use this exception to read another path or write files. Boards can copy to the
clipboard and show in-board messages without asking for these permissions; `clipboardRead` only
controls reading clipboard contents.
