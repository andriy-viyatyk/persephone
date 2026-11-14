---
title: "Boards — permissions"
audience: agent
summary: "Board permission flags (appScripting, fileSystem, themes, …), what each grants, trust vs permissions, and how grants are shown and changed."
---

# Boards — permissions

## Board permissions

Trust controls whether a board runs. Its object-form `permissions` separately gates bridge
capabilities. New blank boards start with every flag false and
`minBridgeVersion: "1.39.0"` for the starter's board-pack i18n and watch API reference; auto-trust
of a board created by Persephone does not add grants.
Keep only permissions used by reachable code. The permission lines below are the approved
user-facing wording:

> This board can do only what is listed below. Without any permission it can still show its own
> pages, work with the document you open in it, copy to the clipboard, and open links inside
> Persephone.

| Manifest declaration | Capability and approved permission line |
|---|---|
| `execute: true` | Run programs/scripts. “Run programs and scripts on this computer.” — **Full access** |
| `service: true` | Run a background program. “Run a background program while Persephone is open.” — **Full access** |
| `fileSystem: false` | `readFile()` can read the currently hosted document; other bridge file APIs and dialogs remain unavailable. Own `board://` assets still work. |
| `fileSystem: "board"` | Board folder and files picked in its dialogs. “Read and write files in this board's folder (including its own code) and files you pick in its dialogs.” |
| `fileSystem: "full"` | Any accessible file. “Read and write any file you can access.” — **Full access** |
| `openExternal: true` | Final OS/browser/application launch. “Open links or files in your browser or another app.” Opening links inside Persephone remains available without it. Without this permission, an HTTP(S) link using the OS-default-browser setting falls back to an internal Browser tab and is noted in the board log; other external schemes are blocked. |
| `appScripting: true` | `persephone.call` and app scripts/agent tools. Capability access has separate grant rules; see <!-- board-template:exclude -->[Capabilities](../capabilities/index.md)<!-- /board-template:exclude -->. “Control Persephone: run app scripts, open and change pages, use agent tools.” — **Full access** |
| `network: false` | Denies `persephone.fetch()`. |
| `network: "internet"` | Public services; local/private network addresses blocked. “Connect to public internet services; local and private network addresses are blocked.” |
| `network: "full"` | Internet, this computer and LAN. “Connect to the internet, this computer, and your local network.” — **Full access** |
| `clipboardRead: true` | Read clipboard. “Read the contents of your clipboard.” Clipboard writes remain available. |
| `camera: true` | “Use your camera.” |
| `microphone: true` | “Use your microphone.” |
| `computerAudio: true` | “Capture audio playing on your computer.” |
| `geolocation: true` | “Read this device's location.” |
| `notifications: true` | “Show desktop notifications.” |
| `themes: true` | “Create, change, delete, and apply app themes.” This does not grant `appScripting`. |

False booleans have no permission line. An all-false board is summarized as **“No permissions
requested.”** Old manifests without object permissions remain **“Unrestricted”**: “This board uses
an older manifest without permission settings, so it can do anything you can: read and write your
files, run programs, and use the network.” Legacy service starts only when the old array contains
`"service"`. A `Full access` badge uses the secondary text “Can reach everything your user account
can.”

Use native `fetch("./data.json")` or `fetch("board://<host>/data.json")` for a board's own files;
these work with `fileSystem: false`. `persephone.fetch()` is remote bridge networking and needs
`network`. If a call rejects with exactly `permission-denied: "<flag>" is not enabled in
board-manifest.json`, inspect that source call and add only its required flag or level. A permission
increase shows the **Board permissions changed** dialog when the board next opens or reloads, with
**Accept** or **Unregister board** (closing it takes the board off its page); pure reductions
reconcile silently. Object-form manifests need `minBridgeVersion >= 1.30.0`.

**Who answers the trust dialogs.** For a board you are building because the user asked you to —
created with `boards.createBoard`, or one the user handed you to develop — the code is yours, and
the user's request already covers running it: answer **Trust Board** or **Accept** yourself
(`dialogs[i].click("Accept")`) and carry on testing, then mention the granted permission in your
report. For any other board — one the user asks you to review, a downloaded or catalog board, a
folder of unknown origin — **Trust Board** and **Accept** are the user's decision: click them only
when the user expressly asks. Never click **Unregister board** unless the user asks for it.

Viewer boards that render untrusted documents should keep `fileSystem: false` and `network: false`
and never receive `execute` or `appScripting`. Injected document script could otherwise rewrite
viewer code to persist or reach outward. The viewer can still display the opened document and read
its own `board://` assets.
