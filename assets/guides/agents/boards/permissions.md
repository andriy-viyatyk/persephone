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
| `execute: true` | Run programs/scripts. “Run programs and scripts on this computer.” — **Full access** The started process uses ordinary Node/OS privileges. |
| `service: true` | Run a background program. “Run a background program while Persephone is open.” — **Full access** Its Node process uses ordinary OS privileges. |
| `fileSystem: false` | `readFile()` can read the currently hosted document; other bridge file APIs and dialogs remain unavailable. Own `board://` assets still work. |
| `fileSystem: "board"` | Board folder and files picked in its dialogs. “Read and write files in this board's folder (including its own code) and files you pick in its dialogs.” |
| `fileSystem: "full"` | Any accessible file. “Read and write any file you can access.” — **Full access** |
| `openExternal: true` | Final OS/browser/application launch. “Open links or files in your browser or another app.” Opening links inside Persephone remains available without it. Without this permission, an HTTP(S) link using the OS-default-browser setting falls back to an internal Browser tab and is noted in the board log; other external schemes are blocked. |
| `appScripting: true` | `persephone.call` and app scripts/agent tools. Capability access has separate grant rules; see <!-- board-template:exclude -->[Capabilities](../capabilities/index.md)<!-- /board-template:exclude -->. “Control Persephone: run app scripts, open and change pages, use agent tools.” — **Full access** |
| `network: false` | Denies frame host-mediated remote requests through `persephone.fetch()` and HTTP(S) `content.open()`. It does not block service or child-process networking. |
| `network: "internet"` | Public services; local/private network addresses blocked. “Connect to public internet services; local and private network addresses are blocked.” |
| `network: "full"` | Internet, this computer and LAN. “Connect to the internet, this computer, and your local network.” — **Full access** |
| `clipboardRead: true` | Read clipboard. “Read the contents of your clipboard.” Clipboard writes remain available. |
| `camera: true` | “Use your camera.” |
| `microphone: true` | “Use your microphone.” |
| `computerAudio: true` | “Capture audio playing on your computer.” |
| `geolocation: true` | “Read this device's location.” |
| `notifications: true` | “Show desktop notifications.” |
| `themes: true` | “Create, change, delete, and apply app themes.” This does not grant `appScripting`. |

The flag's runtime gate and denial result depend on the API being called:

| Flag | What it gates | When denied |
|---|---|---|
| `execute` | Starting board program and script runs. | The runner refuses the start and reports `permission-denied`. |
| `service` | Starting a board service and using its service interface. | The service stays stopped or unavailable with reason `permission-denied`; interface calls reject with that code. |
| `fileSystem` | Host file APIs and file dialogs beyond the hosted document and board assets. | A denied host file operation rejects with `permission-denied`. |
| `openExternal` | Opening OS paths or launching links in another application. | A denied OS open rejects with `permission-denied`; HTTP(S) links may instead fall back to an internal Browser tab under the configured policy. |
| `appScripting` | Board `persephone.call()` and service-side app scripting. | The bridge call rejects with `permission-denied`; a service-side endpoint may be unavailable. |
| `network` | Frame host-mediated remote requests through `persephone.fetch()` and HTTP(S) `content.open()`. | The request rejects with `permission-denied`. It does not sandbox a service or a process started with `execute`/`executeNode`. |
| `clipboardRead` | Chromium clipboard-read permission requests. | Electron's permission policy denies the request; any prompt depends on the request flow. |
| `camera` | Chromium camera permission requests. | Electron's permission policy denies the request; any prompt depends on the request flow. |
| `microphone` | Chromium microphone permission requests. | Electron's permission policy denies the request; any prompt depends on the request flow. |
| `computerAudio` | Board use of the platform computer-audio capture capability. | The capability request rejects with `permission-denied`. |
| `geolocation` | Chromium geolocation permission requests. | Electron's permission policy denies the request; any prompt depends on the request flow. |
| `notifications` | Chromium desktop-notification permission requests. | Electron's permission policy denies the request; any prompt depends on the request flow. |
| `themes` | Board theme RPC methods. | The theme request rejects with `permission-denied`. |

The bridge error is `permission-denied: "<flag>" is not enabled in board-manifest.json` where
the API throws that error. Chromium permission checks are denied through Electron's permission
policy, and service state reports `permission-denied`; there is no single display surface for every
denial.

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
reconcile silently. A board using object-form `permissions` must declare
`minBridgeVersion: "1.30.0"` or newer. If it omits that requirement, this host treats the board as
incompatible and excludes its capability declarations from the registry. The `network` flag gates
`persephone.fetch()` and HTTP(S) `content.open()` from the frame. The board frame's CSP also
blocks direct remote `fetch()`/XHR connections. This is not an OS sandbox: a declared service or
process started with `execute`/`executeNode` can use ordinary Node filesystem and networking APIs
under the user's account, even when `fileSystem: false` and `network: false`. Those flags gate
host bridge APIs for the frame; they do not restrict those processes. See the
<!-- board-template:exclude -->[user permission guide](../../boards/trust-and-permissions.md)<!-- /board-template:exclude -->
for how `openExternal` and internal Browser navigation fit this boundary. `openExternal` governs
OS/browser launching separately; an internal Browser page follows its own session and network
settings, not the board frame's network grant.

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
