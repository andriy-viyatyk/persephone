---
title: "Boards"
audience: both
summary: "Custom HTML-page applications hosted by Persephone and backed by local scripts."
editorId: "board-info"
---

# Boards

Boards let you build fully custom HTML-page applications that can live anywhere on disk and run local scripts on demand. The UI is yours to author as plain HTML — Persephone hosts the page and wires one bridge object, `window.persephone`, so your page can call scripts and show native dialogs.

> **Target audience:** This guide is for users who want to create and use boards. For AI-agent builders, the per-board `CLAUDE.md` inside each board folder is the primary authoring reference.

## Layout

```
+---------------------------------------------------------------------+
| [page nav] [Board Info toolbar]                            [switch] |  shared toolbar with Board Info content and switch at the right
+---------------------------------------------------------------------+
| [Install location] [Browse]                                         |  install-mode location row
| [catalog tiles: Download / Cancel / Retry / Register]               |  install-mode catalog body
| [properties: Open / Uninstall / Unregister]                         |  properties-mode action row
| [published versions: Retry / Update or Install]                     |  published versions body
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Browse → `board-info-browse`
- Download → `board-info-download`
- Cancel → `board-info-cancel`
- Retry download → `board-info-retry`
- Register board → `board-info-register`
- Delete download → `board-info-delete`
- Open board → `board-info-open`
- Uninstall → `board-info-uninstall`
- Unregister → `board-info-unregister`
- Retry published versions → `board-info-versions-retry`
- Update or Install version → `board-info-version-install`

### When Board Info is in install mode

```
+---------------------------------------------------------------------+
| [Install location] [Browse]                                         |  install mode location row
+---------------------------------------------------------------------+
| [available] [downloading] [failed] [downloaded] [registered]        |  catalog board tiles with state-specific actions
+---------------------------------------------------------------------+
```

### When Board Info is in properties mode

```
+---------------------------------------------------------------------+
| [Open] [Uninstall or Unregister]                                    |  properties mode action row for the selected board
| [published versions: loading/error/empty/available]                 |  published versions section below the properties
+---------------------------------------------------------------------+
```

### When a published-version list is loading, failed, empty, or available

```
+---------------------------------------------------------------------+
| [Retry] [published version rows]                [Update or Install] |  published-version list with its state-specific action
+---------------------------------------------------------------------+
```

### When Board Info asks for trust confirmation

```
+---------------------------------------------------------------------+
| [trust confirmation]                                                |  trust confirmation surface before an untrusted board action
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Install progress, dynamic catalog/version rows, and the native install-location folder picker — no entry: progress and rows are repeated state; the picker is an OS dialog.

Evidence: `BoardInfoEditorView.ts:83-90,188-309,316-429,455-470` and `BoardInfoEditorFacade.ts:18-30`.

---

## Concepts

### What is a board?

A board is a small web app stored in any folder on your machine — it is identified by a `board-manifest.json` file in the board's root folder. When you open a board in Persephone, the page renders in a sandboxed context — isolated from the host application — and receives a single injected `persephone` bridge object.

Some editors are shipped as **bundled boards**. They appear in **Tools & Editors → Built-in** rather
than **Boards** / **Registered boards**, and they need no trust confirmation because they are part of
the Persephone installation. The bundled **Excalidraw** board handles `.excalidraw` files and is
included in the offline installation. Right-click it in the Built-in list and choose **Disable** to
remove its file association and its image/diagram handoff capabilities. If no replacement board is
installed, those actions show **No image editor is registered** or **No diagram editor is
registered**. A disabled bundled board stays in the Built-in list, greyed out and no longer
creatable — right-click it and choose **Enable** to bring it back. The change takes effect
immediately, with no restart.

The three parts:

| Part | What it is |
|------|-----------|
| **Frontend** | `index.html` + your CSS/JS. Owns all UI and state. |
| **Backend** | Scripts in `scripts/` (any language — `.js`, `.py`, `.ps1`, `.sh`, …). They run as real OS processes with your privileges. |
| **Channel** | `persephone.execute(commandLine)` — or `persephone.executeNode(script, args?)` to guarantee a Node backend with nothing installed on your machine (see below). The page calls a script, the script prints JSON to stdout, the page parses it and renders. |

### Where do boards live?

Boards can live **anywhere on disk** — any folder containing a `board-manifest.json` file is a board. Persephone creates this file automatically when scaffolding a board.

### Board trust gate

**Each board must be trusted before it renders or runs.** Trust is the first gate; the board's `permissions` in `board-manifest.json` are a second gate that limits what its bridge can do. The Trust board dialog lists the permissions the board requests in plain language. Permissions marked **Full access** can reach everything your user account can. A board with every permission off can still show its own pages, work with the document opened in it, copy to the clipboard, and open links inside Persephone.

- **Boards you create** (via **"New board"**, `app.boards.createBoard()`, or the `boards.createBoard` call path) are **auto-trusted immediately** — no prompt appears.
- **Foreign boards** (any board Persephone did not create for you) show a **Trust board** dialog on first open:

  The dialog lists the board's requested permissions, one per line with a check mark, before you decide. Review the list carefully; **Run programs and scripts**, **App scripting**, and unrestricted file or network access are marked **Full access**. Only trust boards you created or fully understand. If you're not sure about a board, ask your AI agent to review its scripts before trusting it.

- **Trust is per board** (per board root folder), remembered across app restarts together with the permissions you granted. Once trusted you are not prompted again unless the board asks for new or broader permissions (see below). Trust is stored in `%AppData%\persephone\data\trustedBoards.json`.
- **Inherited trust** — when a folder is trusted, every board nested inside it is trusted automatically. You are never prompted for a board that lives within an already-trusted folder.
- **Permission changes need your decision.** If a trusted board adds a permission or raises its access level, the next open or reload shows a **Board permissions changed** dialog. It lists every permission once: a check for kept permissions, **+** for added ones, and a struck-through **−** for removed ones. Choose **Accept** to grant the new set, or **Unregister board** to untrust it (a board installed from the catalog is uninstalled, after a confirmation). Closing the dialog decides nothing: the board is taken off its page (a page left empty closes) and the dialog appears again the next time you open it. Reducing permissions takes effect without a prompt. Updating an installed board does not itself ask again unless its declared permissions change.

Changing a legacy board to an object-form permissions set also asks for trust once, even if the new
set is narrower than the old unrestricted access.

Boards whose manifest has no permissions declaration, or uses the old list format, are **Unrestricted** for compatibility and retain broad legacy access. These boards are deprecated and will stop working in a future Persephone release. The first-trust dialog explains this; opening an already-trusted affected board shows a persistent warning toast. Ask the agent that built the board to add a `permissions` object.

> Only trust boards you created or fully understand. The dialog's permission list shows what bridge access you are granting; review any **Full access** entry carefully.

**How to have it reviewed:** [Reviewing a board before you trust it](./agents/board-review.md) is the checklist to hand your AI agent — what trusting actually grants, what to look for in the board's scripts, and why a board that downloads code and runs it cannot be reviewed at all.

### Service declarations in `board-manifest.json`

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

With `network: "internet"`, Persephone checks every address returned by DNS and connects only to
those checked addresses. A request is blocked if any answer is a local or private address, which
prevents a public hostname from being redirected to your local network through DNS rebinding.

The permission list in the trust dialog uses these meanings:

| Permission | Access it grants |
|---|---|
| `execute` | Run programs and scripts on this computer. **Full access.** |
| `service` | Run a background program while Persephone is open. **Full access.** |
| `fileSystem: "board"` / `"full"` | Read and write the board folder and files selected in its dialogs, or any file you can access. `"full"` is **Full access**. |
| `openExternal` | Open links or files in your browser or another app. |
| `appScripting` | Control Persephone, run app scripts, open and change pages, and use agent tools. **Full access.** |
| `network: "internet"` / `"full"` | Connect to public internet services, or also this computer and your local network. `"full"` is **Full access**. |
| `clipboardRead` | Read the contents of your clipboard. |
| `camera`, `microphone`, `geolocation` | Use your camera or microphone, or read this device's location. |
| `notifications` | Show desktop notifications. |
| `themes` | Create, change, delete, and apply app themes. This does not grant `appScripting`. |

When **Settings → Link Open Behavior** is set to the OS default browser, an HTTP(S) link opened by a
board without `openExternal` opens in Persephone's internal Browser tab instead, with an info line
in the board log. Other external schemes remain blocked and show the existing warning. Grant
`openExternal` when a board needs to open links in the OS browser or another app.

`fileSystem: false` still allows a simple board to read the exact document currently open in that
board. It cannot use this exception to read another path or write files. Boards can copy to the
clipboard and show in-board messages without asking for these permissions; `clipboardRead` only
controls reading clipboard contents.

Bridge `1.8.0` adds the capability and intent methods documented below to the additive provider,
service, and stream-host surface; boards that do not use them continue to work unchanged.
The current board bridge is **1.35.0**. Bridge `1.35.0` adds the permission-gated `persephone.themes.*` API described below. Bridge `1.33.0` adds `persephone.notify(message, type, { persistent: true })`, a toast that stays until you close it. Bridge `1.32.0` allows a simple board with `fileSystem: false`
to read only its currently hosted document through `readFile(getFilePath())`. Bridge `1.23.0` uses one extension-to-MIME table for
`board://` files and `__pipe` responses; markdown, CSV, XML, and YAML board text uses UTF-8.
Bridge `1.22.0` adds host-managed module-service lifecycle
and structured service errors. Bridge `1.21.0` adds optional `representation` to capability
discovery and manifest declarations. A board declaring `content.view` must provide one non-empty
representation per supported format and set `minBridgeVersion: "1.21.0"`. Capability requests to the same handler page are delivered
one at a time in FIFO order; up to 32 active and queued requests can be outstanding for a handler.
An expired deadline rejects with `Capability invocation deadline elapsed.` and sends a best-effort
cancel. Bridge `1.19.0` added `persephone.intent.resolve(value, { discardPage: true })` (also
available on the request-bound `request.resolve`) for discarding a page created for a failed
request, preserved the handler's exact value under `result` for board callers, and added the
optional manifest capability field `alwaysOpensNewPage` to request a fresh handler page for every
invocation. See [What's New](./whats-new.md) for the release notes.

Boards can also declare service-backed content providers:

```json
{
  "contentProviders": [{ "type": "acme/mem", "schemes": ["mem"] }]
}
```

The provider `type` must contain `/`; un-namespaced types are reserved for the platform. The type
is persisted in page pipe state, so renaming it orphans pages carrying the old descriptor. Provider
types and schemes use one-owner registration: the first trusted board wins, and a losing board is
reported with its owner in Board Info. When a board registration is refused, Persephone shows a
toast the first time that issue appears and lists it in Board Info. This also applies to refused
capability, settings, and browser URL mask registrations. Boards may not claim `http`, `https`,
`file`, `data`, `blob`, `mneme`, or any `persephone-*` scheme. `service: true` is required to run
the declared background service. Provider registration is
controlled by the `contentProviders` declaration itself; it is separate from the permission flags.

Register the implementation from the declared module service, not from the board page:

```js
persephone.providers.register("acme/mem", {
    readBinary(config) {
        return new TextEncoder().encode(`content for ${config.name}`);
    },
    stat() {
        return { exists: true };
    },
});
```

`readBinary()` must return a `Uint8Array`; `writeBinary()`, `stat()`, and `watch()` are optional.

Add `readRange(config, range)` to serve ranged reads without buffering the whole resource into
memory first — this is what lets the built-in editors (Monaco, Image, the media player) and a
`stream-host` page's `persephone.host.streamUrl()` seek through a board's own provider. `range` is
`{ start, end }` (inclusive byte offsets); **return a `Uint8Array`, the same as `readBinary()` —
never a stream** (Persephone's own pipe layer has a separate, unrelated streaming concept with a
similarly-named method; `readRange` is not that — it is a bounded, byte-returning read, like
`readBinary()` but for a slice). Return at most `range.end - range.start + 1` bytes, and never more
than 1 MB in one call — the platform pulls a large read as a sequence of bounded requests and asks
again for the next range once the previous one is consumed:

```js
persephone.providers.register("acme/mem", {
    readBinary(config) { /* ... */ },
    readRange(config, range) {
        const data = loadFromWherever(config);
        return data.subarray(range.start, range.end + 1);
    },
    stat(config) {
        return { exists: true, size: totalSizeOf(config) };
    },
});
```

`readRange` is optional and detected automatically from what you register — nothing in
`board-manifest.json` declares it. A provider that omits it keeps working exactly as before: every
read still goes through `readBinary()`, buffered and capped at 256 MB. Adding `readRange` also
means `stat()` must now return a `size` — seeking needs a length to seek against, and a resource
over 256 MB can only be opened through the ranged path.

**Content reads and metadata sizing (`readBinary`, `readRange`, and `stat`) have no deadline.**
`content.open()` resolves size eagerly, so its `stat()` call follows the same cancellation-only
rule. `writeBinary()` and `watch*()` retain the 10-second deadline. Release happens instead through
cancellation: closing the page, the board deleting its own backing resource (the read then fails
naturally, from inside your implementation), the service stopping, or the platform abandoning
interest (e.g. a seek superseding a previous chunk request). Each unbounded method receives an
optional trailing `{ signal }` argument — second for `readBinary`/`stat`, third for `readRange` — an
`AbortSignal` that fires when the platform stops waiting:

```js
persephone.providers.register("acme/mem", {
    readBinary(config, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return loadFromWherever(config);
    },
    readRange(config, range, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return loadFromWherever(config).subarray(range.start, range.end + 1);
    },
    stat(config, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return { exists: true, size: totalSizeOf(config) };
    },
});
```

**Honoring the signal is optional; tolerating its presence is mandatory.** An implementation
written before this option existed — one or two arguments, no `options` parameter — keeps working
exactly as before; the platform now passes one extra trailing argument it has never declared and
therefore never reads. A well-behaved provider that does inspect `options.signal` can stop real
work early (close a socket, cancel a torrent piece request, abort a `fetch()`); a provider that
ignores it is not broken and not penalized — the platform stops waiting either way, it is only the
underlying work that keeps running until your own code notices.

The service starts when a page first reads from its provider. A saved page keeps its provider
descriptor while the board is absent or untrusted: it reports **Provider missing** and remains
restorable. After you trust or reinstall the declaring board, retry the read in the same page. If the
service is unavailable or does not register the provider, the read can fail; after correcting the
service, retry the read from that page.

### Torrent-style self-contained provider links

A provider that needs to restore a resource without its board page open must put everything needed
to identify that resource in the persisted URL. The torrent viewer uses the `torrent/viewer`
provider and creates links in this form:

```text
torrent://<40-lowercase-hex-infohash>/<encodeURIComponent(normalized-file-path)>?magnet=<encodeURIComponent(magnet-uri)>
```

Normalize the file path to `/` before encoding it as one URL path value. The provider receives the
complete href in `config.url`, not separate `infoHash` and `path` fields; the embedded magnet is
what makes a cold-start restore possible. WebTorrent piece selection and prioritisation belong to
the provider's implementation. `readRange` remains an optional bounded byte-returning method, not
a stream.

### Browser-download URL masks

`browserUrlMasks` is a declaration on `board-manifest.json` that is independent of `fileMasks`.
`fileMasks: ["*.torrent"]` associates a local file name; it does not opt the board into Browser
download interception. A board that wants both claims declares both explicitly:

```json
{
  "fileMasks": ["*.torrent"],
  "browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
}
```

Values are trimmed, lowercased, de-duplicated, and bounded to 64 masks of at most 512 characters
each. They are case-insensitive whole-URL globs anchored at both ends. That anchoring matters:
`*://*/*.torrent` matches `https://example.test/a.torrent` but misses
`https://example.test/a.torrent?dl=1`; declare the query-form mask alongside it.

This contract applies only to Browser downloads, before the save dialog; ordinary navigation is not
captured. A live run confirmed that a matching download is cancelled, creates no save path or
download entry, and opens the source URL in the board that won the claim. Persephone also notifies
you with the board's name.

When a matching download starts from a Tor or Incognito page, Persephone fetches the source through
that page's browser session. With bridge 1.24.0, the board receives `privateSession: true` on
`source.onOpen` for later source opens, and `source.initialSourcePrivateSession` reports the status
of the page's initial source. The Torrent Viewer board uses this information to explain that the
private session applies only to fetching the source; the torrent's tracker and peer connections are
not routed through Tor, so other peers can see your real IP. Persephone no longer shows a
torrent-specific privacy toast for this case. From Torrent Viewer 1.8.0, the network indicator in
the board's status bar can put all tracker, peer, and web-seed traffic behind a SOCKS5 proxy
instead; the board then says so in that notice.

Only trusted boards and enabled bundled boards contribute claims. Registration order is trusted
roots followed by bundled boards; an exact normalized duplicate is refused and reported as a
`browser-url-mask` registration issue, with a toast the first time it appears and an entry in Board
Info. Distinct overlapping masks remain ordered and the first matching claim wins. Trust and
bundled eligibility protect registry correctness and user disclosure; trust is not a sandbox or a
per-API permission gate, and a trusted board is a user application with the execution privileges
described above.

### Capability handlers and in-memory intents

A board can provide named work without making callers know which board handles it. Declare the
capability in `board-manifest.json`; the declaration array controls registration. A handler that
calls Persephone scripts, object model APIs, or agent tools also needs `appScripting: true`; declare
only the permissions its code uses.

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": {
    "execute": false, "service": false, "fileSystem": false,
    "openExternal": false, "appScripting": false, "network": false,
    "clipboardRead": false, "camera": false, "microphone": false,
    "geolocation": false, "notifications": false, "themes": false
  },
  "capabilities": [
    { "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting" },
    { "id": "content.view", "representation": "pdf", "priority": 70 }
  ]
}
```

Declarations support `id`, integer major `version` (default `1`), numeric `priority` (default
`50`), optional MIME `accepts`, descriptive `payloadSchema`, display `title`, `headless`, and the
optional boolean `alwaysOpensNewPage`. Set that flag when each request must open a fresh handler
page, even when another page for the board is already open. Without it, Persephone reuses an open
handler page. IDs cannot contain whitespace or `@`; vendor prefixes are recommended. Multiple
boards may declare the same id. The
highest priority wins, platform handlers win exact ties, and trusted-board registration order
breaks board-to-board ties. A caller may pin a major version with `invoke("demo.greet@1", payload)`.
`representation` is an open string. `content.view` requires a non-empty value; use one declaration
per supported format and set `minBridgeVersion: "1.21.0"`. Other capability ids may omit it.

Well-known platform capabilities include `http.request.open` (open a REST request collection),
`image.edit` (open an image in an editor), and `certificate.view` (render a site's TLS certificate
chain). A board may claim `certificate.view` with a normal manifest declaration and handle v1
requests through `persephone.intent.onRequest()`. Its payload is `{ title, certificates, source? }`:
`title` is the hostname, `certificates` is a leaf-first array of base64 DER strings, and optional
`source.url` identifies the HTTPS page. Persephone validates the shape and limits decoded DER to
256 KiB before dispatch.

Settings also uses the platform-provided `theme.edit@1` capability to open an installed Theme Editor
board. The payload is `{ mode: "edit", themeId: string }` or `{ mode: "new" }`. Persephone validates
that shape before handler resolution: edit requires a non-empty theme id and new must not include a
`themeId`. A board claims it with `{ "id": "theme.edit", "version": 1, "priority": 50,
"title": "Theme Editor" }` and receives fresh or reused requests through
`persephone.intent.onRequest()`. Settings applies the selected theme before edit; new leaves the
active theme unchanged. Accept a valid intent before loading its source or showing UI, because the
caller deadline covers board startup. Without `alwaysOpensNewPage`, an existing page is focused and
reused. The `themes: true` permission is needed only for the board's `persephone.themes.*` access,
not for capability dispatch. If no handler is registered, Settings opens Tools & Editors → Search
boards and explains how to install Theme Editor; timeout is reported separately.

The winning board is served in the caller's window. Persephone reuses an already-open handler page
there or opens one there and delivers the initial request in its handshake. Later requests to that
page use the host-frame channel. This applies to any trusted board that declares the winning
capability, regardless of its editor kind. The handler receives a structured request and must
settle it:

```js
function handleGreeting(request) {
    if (handled.has(request.requestId)) return;
    handled.add(request.requestId);
    const name = request.payload.name ?? "friend";
    request.resolve({ greeting: `Hello, ${name}`, requestId: request.requestId });
}

const handled = new Set();
persephone.intent.onRequest(handleGreeting);
const initial = persephone.intent.get();
if (initial) handleGreeting(initial); // the page was opened for this request
```

`persephone.intent.get()` returns the current request, if one is active.
`persephone.intent.onRequest(callback)` returns an unsubscribe function and also delivers an
already-active request. `persephone.intent.resolve(value)` and `persephone.intent.reject(reason)`
settle the current request. Prefer the request-bound `request.resolve` and `request.reject`
methods in callbacks. Use `request.resolve(value, { discardPage: true })` when a failed request
should discard the page it opened. The value remains opaque, and the option is ignored when
Persephone reused an existing page. **Settlement is mandatory:** a handler that never
calls either method leaves its caller waiting until the deadline. The platform then sends a
best-effort cancel, but cannot stop the handler's work.

`persephone.capabilities.list()` discovers registrations without opening a handler. The
`handlerKey` field distinguishes multiple handlers for one id:

```js
const handlers = await persephone.capabilities.list();
// [{ id: "demo.greet", version: 1, priority: 60,
//    handlerKey: "board:/work/Demo", origin: "board", title: "Demo greeting" }]
```

`persephone.capabilities.invoke(id, payload, options?)` resolves by id; options may pin `version`
or set `deadlineMs`. A board result is `{ pageId, result }` (the page id is optional for handlers
that resolve without a page); `result` preserves the handler's exact value, including primitives,
arrays, and empty objects. Handle the ten typed rejection codes as follows:

Invocations to the same handler page are delivered serially in FIFO order: only one request is
active in a frame, and later requests wait for it to settle or be cancelled. `busy` means the
handler has reached the bus limit of 32 outstanding requests across its active and queued work.
When a deadline expires, callers receive `Capability invocation deadline elapsed.` and the
platform sends a best-effort cancel.

| Code | Meaning to the caller |
|---|---|
| `no-handler` | No registered declaration matches the id, version, or filter; headless winners are out of scope. |
| `untrusted` | The handler board was untrusted at resolution or while the request was in flight. |
| `handler-closed` | The handler page or frame closed before it settled. |
| `crashed` | The handler frame errored or reloaded during the request. |
| `cancelled` | The caller cancelled, its page closed, or the renderer is tearing down. |
| `timeout` | The deadline elapsed; the caller receives `Capability invocation deadline elapsed.` and a best-effort cancel is sent. |
| `cycle` | The winning handler is already in the request chain or the depth limit was exceeded. |
| `payload-too-large` | A board-bound inline payload exceeds 8 MiB. |
| `busy` | The handler has reached the bus limit of 32 outstanding requests, including queued work. |
| `rejected` | The handler called `reject()`, the payload could not be structured-cloned, or the transport failed without another code. |

Timeout does not stop handler execution. An agent may retry, so a handler that needs idempotency
must key its work on `requestId`. Intents are at-most-once: Persephone never re-delivers the same
request. Payloads are structured-cloned, kept in broker memory, and delivered once; they never
enter page state or disk, and a restored page does not receive them again. This is a broker policy,
not an OS guarantee — memory can be paged and Chromium may retain its own caches.

Scripts running in Persephone can discover or invoke the same indexed handlers through
[`app.capabilities`](./scripting/api/app.md#capabilities). Board pages use the asynchronous
`persephone.capabilities` bridge documented above.

Scripts should use `app.capabilities.invoke()` for capability calls.

---

## Getting started

### 1. Create a board

**From the Boards panel (recommended):** open any folder in the **File Explorer** sidebar, then click the **Boards** button in the Explorer header to open the Boards panel. Click **New board** — a dialog opens asking for a folder and a name. The folder defaults to the current Explorer root (you can change it or browse to another location). A live label previews the final path. Click **Create** and the board is scaffolded, trusted, and opened in a single step.

To install a full working demo board instead, click the caret on the **New board** split-button and choose **Create Demo board**.

**From scripting or an AI agent:**
```javascript
// Create a blank board in any folder — auto-trusted at creation
const root = await app.boards.createBoard("My Board", "C:/work/boards");
await app.boards.openBoard(root);

// Or scaffold from the Demo template
const root = await app.boards.createDemoBoard("Demo", "C:/work/boards");
await app.boards.openBoard(root);
```

The board opens immediately after creation.

### 2. Open an existing board

- **Boards panel** — click the **Boards** button in the Explorer header. All trusted boards under the current root are listed as a tree. Click any board name to open it in the current tab. Right-click a board for **Open in New Tab** — opens it in its own dedicated tab instead of replacing the current tab's content, so its iframe (and any dev-server process it spawned) keeps running while you work in other tabs. A board whose spawned processes are still running (via `persephone.setBoardBusy(true)` — see [Long-running processes](#long-running-processes-setboardbusy--getboardbusy--getjobs)) shows a green **running** dot next to its name, even after its tab has moved on to something else.
- **File Explorer panel** — rows for `board-manifest.json` files show an **Open Board** button (board icon) directly in the row. Click it to open that board. (Clicking the row itself opens the JSON in Monaco.)
- **Tools & Editors panel → Boards tab** — lists all trusted boards, grouped by folder, across all locations. Click a board to open it in a new tab. Pin a board to make it appear in the top pinned section and in the **+** (add page) dropdown. Click **Open in new tab** in the panel header for a full-page version of the same hub, with an additional **Search boards** tab for discovering and installing boards published by the project — see [Published boards catalog](#published-boards-catalog--discover-install-update) below.
- **Scripting / agent** — call `app.boards.openBoard(boardRoot)` with the absolute path to the board's root folder.

Bundled boards are opened from the **Built-in** list rather than from the Boards panel. They do not
write to the board trust list. Their stable bundled identity also means an open page and its saved
state continue to refer to the same board when the application is installed in a different folder.

### 3. Edit and reload

Boards do **not** reload automatically when files change. To apply edits to `index.html`, `app.js`, or any `.js`/`.css`, choose **Reload board** from the in-board toolbar's **…** menu. AI agents editing board files should call `pages[pageId].editor.reload()` and then re-run `pages[pageId].editor.snapshot()` to see the updated board.

Settings declared in `board-manifest.json` appear as a Settings panel once the board is trusted or
bundled. The registry caches the manifest, so editing that file directly does not update the
Settings page live; toggle trust off and on or restart Persephone to refresh it.

### Board settings

A board can declare user-editable settings in its manifest. The declaration requires stable,
non-empty `name` and `author` fields, and each setting needs a unique `id`, a scalar `type`, and a
default value. Supported types are `string`, `number`, `boolean`, and `enum`; enum settings also
provide a non-empty `options` array. Use `format: "folderPath"` for a string that should be edited
with a folder picker.

```json
{
  "schemaVersion": 1,
  "name": "Weather Board",
  "author": "Example",
  "settings": [
    {
      "id": "units",
      "type": "enum",
      "options": ["celsius", "fahrenheit"],
      "default": "celsius",
      "label": "Temperature units",
      "description": "How temperatures are displayed."
    },
    {
      "id": "data-folder",
      "type": "string",
      "format": "folderPath",
      "default": "",
      "label": "Data folder"
    }
  ]
}
```

The settings appear in a board-named panel in **Settings**. A board that is also a custom editor
appears under **Editors**; a standalone board appears under **Boards**. Persephone stores explicit
values in `%APPDATA%\persephone\data\board-settings.json`, namespaced by the board's stable
`author`/`name` identity. Resetting a setting removes its stored value and restores the manifest
default.

Inside the board, bridge version **1.13.0** adds read-only settings access:

```js
const units = await persephone.settings.get("units");

const stopListening = persephone.settings.onChange(({ id, value }) => {
  if (id === "units") renderUnits(value);
});

// Call stopListening() when the board no longer needs notifications.
```

`get()` returns the stored value or the current manifest default when no value is stored.
`onChange()` reports effective values after a user edits or resets a setting in Persephone. The
board cannot write its setting values through the bridge; use the Settings panel for changes.

---

## In-board toolbar

Every open board displays a thin toolbar above the board's content area. The toolbar provides quick access to board operations without leaving the board view.

| Control | Description |
|---------|-------------|
| **File Explorer** (folder icon) | Open the File Explorer panel rooted at the board's parent folder. |
| **Text slot** | Empty unless the open board fills it with `persephone.toolbar.setText()`. A non-interactive label; the board's own folder path is under **… → Board properties** and the tab's **Copy Board Path**. |
| **…** (Board actions) | Open **Reload board**, **Open board log**, and **Board properties**. A board can add its own actions at the top of this menu. An update-available dot appears here when a newer catalog version is ready. |
| **Board controls** | Controls the open board declared for itself — buttons, toggles, menus, dropdowns, segmented choice buttons and text boxes — shown between the label and Persephone's own buttons, and separated from them. They belong to the board, so they change with it and disappear when it reloads until it declares them again. |

Trusted and bundled boards can declare these controls with `persephone.toolbar.set()` and handle
their picks with `persephone.toolbar.onAction()`. A `segmented` control shows joined choice buttons
with one value selected; use it for a few short, always-visible options. Each option needs a label,
an icon, or both. Buttons and menus work the same way: give one a `label` for a text button, an
`icon` for an icon button, or both. A menu with `placement: "board-menu"` adds its items to the top
of the **…** menu instead of showing a button of its own:

```js
persephone.toolbar.set([
  { id: "save", type: "button", label: "Save" },
  { id: "refresh", type: "button", title: "Refresh", icon: { name: "refresh" } },
  { id: "more", type: "menu", placement: "board-menu", items: [{ id: "export", label: "Export JSON" }] },
  { id: "scope", type: "segmented", value: "active", options: [
    { value: "active", label: "Active" },
    { value: "all", label: "All" },
  ] },
]);
persephone.toolbar.onAction(({ id, type, value }) => {
  if (id === "save") save();
  if (id === "scope" && type === "segmented") showScope(value);
});
```

The `segmented` type requires board bridge `1.28.0`; set `minBridgeVersion: "1.28.0"` in the
board manifest when using it. See the [board authoring reference](./agents/boards.md#host-rendered-board-toolbar)
for all control types and option details.

---

## Default right-click menu

Right-clicking inside a board's content works exactly like right-clicking anywhere else in Persephone, with no setup needed from the board author:

| Right-click target | Menu items |
|---------------------|------------|
| A link | **Open Link**, **Copy Link** |
| An image | **Open Image in New Tab**, **Copy Image**, **Save Image As…** |
| A text field, text area, or editable region | **Cut** / **Copy** / **Paste**, depending on whether there's a selection and whether the field is read-only |
| Selected text (not in an editable field) | **Copy** |

**Open Image in New Tab** opens the image in Persephone's Image Viewer as its own tab, the same way opening an image file normally does. **Save Image As…** shows the native Save dialog and writes the file to disk.

If a right-click doesn't match any of the above (for example, empty space with nothing selected), no menu appears — the board's own page just gets a normal right-click with nothing added.

A board that wants to draw its own custom right-click menu instead can call `event.preventDefault()` in its own `contextmenu` handler; Persephone's default menu only appears when the event reaches it unhandled.

---

## The board bridge — `window.persephone`

The only Persephone-specific API a board sees is `window.persephone`. Everything else is plain web development.

### `persephone.execute(commandLine, options?)`

Runs a command on your machine and returns a process handle:

```js
// Options: cwd (default = board folder), env, shell, name
const handle = persephone.execute("node scripts/load.js");
```

**Buffered — collect all output at once:**

```js
const data = await handle.getJson();           // parse stdout as JSON; reject on non-zero exit
const text = await handle.getText();           // stdout as string
const bytes = await handle.getBytes();         // stdout as Uint8Array
```

`getJson()` rejects if the process exits with a non-zero code or if the output cannot be parsed. The rejection error is a `RunnerError` (`err.name === "RunnerError"`) with `exitCode` and `stderr` properties, so you can tell a process failure apart from any other error your own code might throw.

**Pattern extraction** — useful when a script's stdout mixes your result with other output:

```js
// Script emits: @@RESULT@@{"items":[...]}
const data = await handle.getJson(/@@RESULT@@(.*)/);
```

**Streaming — receive output as it arrives:**

```js
handle.on("stdout", chunk => console.log(chunk));
handle.on("stderr", chunk => console.error(chunk));
handle.on("exit", info => console.log("exit code:", info.exitCode));
handle.on("error", err => console.error(err));
```

**Sending input and stopping:**

```js
handle.write("hello\n");    // write to stdin
handle.endStdin();          // close stdin (signals EOF to the script)
handle.kill();              // terminate the process
```

> **Buffered vs streaming:** choose one per handle — mixing them throws an error. For a simple request-response pattern, use `getJson()` / `getText()`; for long-running or progress-reporting scripts, use `on(...)`.

### `persephone.executeNode(script, args?, options?)` — a guaranteed Node backend

`persephone.execute("node script.js")` only works if the **user's machine** happens to have Node installed — a board you build (or one someone else installs from the [published catalog](#published-boards-catalog--discover-install-update)) can't rely on that. `executeNode` instead runs the script on **Persephone's own bundled Node runtime** — the same Node build the app itself ships with — so it works on any machine with **zero setup**, no Node or Python install required:

```js
const handle = persephone.executeNode("scripts/query.mjs", ["arg1", "arg2"], { cwd, env, name });
```

- **`script`** — a path relative to the board folder (or absolute). Prefer a `.mjs` extension for explicit ES modules — boards ship no `package.json`, so Node's automatic module-type detection is the only other signal.
- **`args`** — an array of strings passed **argv-style, with no shell involved**. A value containing spaces (e.g. `"a b"`) always arrives as a single argument — no quoting rules to get right, and no shell-injection risk. The `options.shell` setting exists only for symmetry with `execute()`; `executeNode` always ignores it and never runs through a shell.
- **`options`** — same shape as `execute()`: `cwd` (defaults to the board folder), `env`, and `name` (the re-association key for `getJobs()`, same as below).
- **Returns the same handle** as `execute()` — buffered (`getText()` / `getJson()` / `getBytes()`), streaming (`on("stdout"|"stderr")`), and `write()` / `endStdin()` / `kill()` all behave identically.
- The runtime is **Node 24**, with **`node:sqlite` built in** (including FTS5 full-text search) — a board can query a SQLite database with zero `npm install`.
- If the script file doesn't exist, the handle fires an `error` event with a clear message (`Node script not found: <path>`) instead of a cryptic process failure.

**Resident backend server** — since the handle keeps stdin open for writing, a board can spawn **one long-lived script for the whole session** and send it requests as JSON lines, instead of paying a fresh process spawn for every operation:

```js
const srv = persephone.executeNode("scripts/db-server.js", [dbPath], { name: "db" });
srv.on("stdout", chunk => handleJsonLine(chunk));               // e.g. {id, columns, rows} or {id, error}
srv.write(JSON.stringify({ id: 1, sql: "SELECT ..." }) + "\n");  // per request — no re-spawn, db stays open
```

One spawn when the board opens; after that, each request costs only its own work (e.g. a SQLite query against an already-open, warm database). Pair this with `setBoardBusy(true)` (see below) so the server survives a board reload, and re-attach to it by `name` via `getJobs()`.

### Declared services, storage, and lifecycle

The [board template's authoring guide](../board-template/CLAUDE.md#declared-module-services-manifestservice)
is the canonical choice guide for service versus `executeNode()`. A service is declared with a
board-relative ESM entry such as:

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": {
    "execute": false, "service": true, "fileSystem": false,
    "openExternal": false, "appScripting": false, "network": false,
    "clipboardRead": false, "camera": false, "microphone": false,
    "geolocation": false, "notifications": false, "themes": false
  },
  "service": "scripts/service.mjs"
}
```

The platform starts the service lazily in its bundled utility-process Node runtime. Its cwd is the
board root, imports resolve `node_modules` from that root, and standard Node built-ins are
available, including filesystem, networking, streams, crypto, workers, and timers. It does not
receive Electron objects such as `electron`, `app`, `BrowserWindow`, `webContents`, or `ipcMain`.
The environment is sanitized to the supervisor allowlist plus `PERSEPHONE_SERVICE=1` and
`PERSEPHONE_BOARD_ROOT`. Service stdout and stderr are captured in the board's `ui.log`. For
boards you add, that file is `<boardRoot>/ui.log`; bundled boards keep it at
`%APPDATA%\persephone\board-logs\<id>\ui.log`.

The service host injects `persephone.storage`, and the service shares the frame's per-board JSON
store. A service can handle requests and provider operations from multiple windows concurrently;
reloading or closing one window does not interrupt the others. Use the bridge rather than writing
`store.json` yourself:

```js
await persephone.storage.set("last-result", { ok: true });
const reply = await persephone.service.request({ op: "refresh" });
const sameValue = await persephone.storage.get("last-result");
```

`persephone.service.request(message)` uses structured-clone messages, starts the service on first
use, and rejects with lifecycle errors such as `untrusted`, `permission-denied`, `service-busy`,
`service-timeout`, `service-exited`, or `service-failed`. Service status is visible in
`app.boards.list()` as `service.state`, `reason`, `pid`, `startedAt`, and `restartCount`. The
The `service` permission controls whether the declared background program can run. The Trust board
dialog and Board Info show the permission set granted to that board.

The host owns `init`, `ready`, `probe`, request replies, and shutdown for new-API entries. Register
the request handler and any shutdown callbacks during top-level evaluation, before asynchronous
startup work:

```js
persephone.service.onRequest(async (message) => handleRequest(message));
persephone.service.onShutdown(async ({ reason }) => closeServiceResources(reason));
```

`onRequest(handler)` accepts one function. It receives the opaque structured-clone message sent to
`persephone.service.request(message)`; the returned value becomes the caller's result. If a request
arrives before a handler is registered, the host replies with
`{ code: "service-handler-not-registered", message }`. A rejected handler becomes
`{ code, message }`, using a non-empty `error.code` when supplied and otherwise `service-error`;
the board receives an `Error` with both `.message` and `.code`. Import failures are logged and
stop startup without sending `ready`.

`onShutdown(fn)` accepts multiple callbacks. Each receives `{ reason }` (`"untrusted"`,
`"explicit"`, or `"quit"`) and runs sequentially in registration order. The host attempts every
callback, then exits with status 1 if any callback failed. Keep cleanup within the main process's
2-second shutdown deadline.

Do not combine `persephone.service.onRequest()` with a raw `process.parentPort` message listener.
An entry with a raw listener selects the legacy protocol, so the host does not answer lifecycle or
request messages; when both APIs are present, raw mode wins and `onRequest` is ignored. Existing
raw-protocol entries remain supported during this transition. New entries should use the host API:

```js
persephone.service.onRequest(async ({ op, value }) => {
    if (op !== "lookup") throw Object.assign(new Error("Unsupported operation."), { code: "invalid-operation" });
    return await lookup(value);
});
persephone.service.onShutdown(async ({ reason }) => {
    await closeDatabase();
    console.info(`Stopped: ${reason}`);
});
```

### Long-running processes: `setBoardBusy()` / `getBoardBusy()` / `getJobs()`

By default, a board's spawned processes are **killed whenever the board unloads** — the user navigates the page to something else, or chooses **… → Reload board**. A board that starts a dev server, watcher, or any process meant to keep running opts out with the busy flag:

```js
// Start a long-running process and name it
persephone.execute("npm run dev", { name: "backend" });
persephone.setBoardBusy(true);

// On every board startup — re-enter "running" mode if a previous lifetime left work running
if (await persephone.getBoardBusy()) {
    const jobs = await persephone.getJobs();
    const backend = jobs.find(j => j.name === "backend");
    if (backend) showRunningUi(backend);              // backend.kill() stops it
    if (jobs.length === 0) persephone.setBoardBusy(false); // nothing survived — reset the flag
}

// Stop it
backend.kill();
persephone.setBoardBusy(false);
```

- **`persephone.setBoardBusy(true)`** — declares "my processes must outlive me". While busy, unloading the board (navigating its page elsewhere, or **… → Reload board**) leaves its processes running. They are still killed when the page/tab is closed, when Persephone quits, or after you call `setBoardBusy(false)` and the board next unloads.
- **`persephone.getBoardBusy()`** → `Promise<boolean>` — the flag itself survives a reload (it lives in the app, not the board's JS). Read it on startup to know whether you should re-enter "running" mode.
- **`persephone.getJobs()`** → `Promise<PersephoneJobInfo[]>` — this board's currently live jobs, including ones spawned by a previous lifetime of the board (the board's own JS state, including any `execute()` handles, does not survive a reload). Each entry has `jobId`, `command`, the optional `name` you gave it, and `kill()` / `write()` / `endStdin()`. Surviving jobs are **control-only** — there is no `stdout`/`stderr`/`exit` streaming for them (their output went to the previous lifetime; anything a process prints while the board is unloaded is dropped). Poll `getJobs()` if you need to notice a job has exited.
- **Name your long-running jobs** — pass `{ name: "backend" }` to `execute()`. The name is the re-association key `getJobs()` uses after a reload, since a board cannot rely on `localStorage` to remember an old `jobId` (board storage does not persist across app restarts).

A busy board still shows a green **running** dot next to its name in the **Boards** panel, so a process left running in the background stays discoverable.

**Related but different:** opening a board with **Open in New Tab** (see [below](#2-open-an-existing-board)) keeps the whole board — iframe and all — alive in its own tab. `setBoardBusy()` is for the opposite situation: you replaced the board's tab with something else (or reloaded it) and only need its *processes*, not the board UI, to survive.

### Integration methods

These handle in-app effects that `execute()` cannot express:

| Method | Description |
|--------|-------------|
| `persephone.notify(message, type, options?)` | Show a toast. `type`: `"info"`, `"success"`, `"warning"`, or `"error"`. Info, success and warning toasts close after a few seconds; `{ persistent: true }` (bridge 1.33.0) keeps the toast until you close it. Errors and warnings are also appended to `ui.log`. |
| `persephone.clipboard.writeText(text)` | Write text to the OS clipboard. Useful for board actions triggered from Persephone's own toolbar, where the board page may not be focused. |
| `persephone.clipboard.writeImage(data)` | Write encoded image bytes (`Uint8Array` or `ArrayBuffer`) to the OS clipboard. |
| `persephone.icons.forFiles(names)` | Get the icon Persephone shows for each file name, as `{ [name]: dataUrl }` for `<img src>`, so a board's file list can match the Explorer. The file does not need to exist. Single-colour icons follow the current theme; request again after `persephone.onThemeChange` fires. |
| `persephone.openRawLink(href, options?)` | Open a file or URL in a new Persephone tab. Pass `{ editor }` (e.g. `{ editor: "md-view" }`) to request a specific editor — for example, render a Markdown doc instead of opening its source; falls back to the default editor when omitted. |
| `persephone.openContent(options)` | Create a new in-memory page in another content-host editor and return its page id. Use this for content held by the board rather than a file or URL. |
| `persephone.openFileDialog(params?)` | Show a native Open File dialog; returns the selected path. |
| `persephone.saveFileDialog(params?)` | Show a native Save File dialog; returns the chosen path. |
| `persephone.openFolderDialog(params?)` | Show a native Open Folder dialog; returns the selected path. |
| `persephone.readFile(path, options?)` | Read a file and return its contents (Promise). A relative `path` resolves against the board folder; absolute reads anywhere. Text by default; `{ encoding: "binary" }` returns a `Uint8Array` (the right choice for binary files — app 4.0.21+), `{ encoding: "base64" }` a base64 string. |
| `persephone.writeFile(path, data, options?)` | Write a file (Promise); creates parent folders. A relative `path` resolves against the board folder. Text by default; `{ encoding: "binary" }` takes a `Uint8Array`, `{ encoding: "base64" }` a base64 string. |

### `persephone.openContent(options)`

Use `openContent` when the board has generated content in memory — for example, a Markdown
summary, an extracted graph, or a table — and wants to show it in a new Persephone page:

```js
const pageId = await persephone.openContent({
    editor: "md-view",
    language: "markdown",
    title: "Node report",
    content: markdown,
});
```

`editor` is a registered content-host editor such as `"monaco"`, `"grid-json"`, `"md-view"`,
`"mermaid-view"`, or another registered content-host editor. `language` defaults to `"plaintext"` and `title` to
`"untitled"`. The call creates the page and returns its id; it does not provide a way for the
board to read, navigate, close, or modify other pages. It rejects for an unknown editor or
language, a standalone editor, another board, or content over 16 million characters, so handle
the returned Promise.

The bundled Excalidraw board is a content-host board. Opening an image, SVG, or Mermaid result in
Excalidraw routes it to the enabled board. If it is disabled, install or enable another board that
provides the required image or diagram capability; otherwise Persephone reports that no such
editor is registered.

### `persephone.call(path, options?)`

Trusted Boards can resolve the bounded AiVision object model from the page hosting the Board:

```js
const source = await persephone.call("page.grouped.content");
const matches = [...source.matchAll(/TODO\w*/g)].map((m) => ({ match: m[0], index: m.index }));
await persephone.call("page.grouped.content", { value: JSON.stringify(matches, null, 2) });
```

The method always suppresses hints and returns only a JSON-safe shaped value. `args` calls the final
method, `value` assigns a writable property, and an explicit `maxLength` optionally bounds strings
or structured results; structured truncation keeps whole values. Board calls are unbounded by
default, so a large string arrives intact. `persephone.call()` returns the value itself; the
the `shown`/`total` metadata is part of the external MCP `call` envelope. `args` and `value` are
mutually exclusive. Calls reject as `Error` on resolver, transport, timeout, or trust failures.
Trust is checked at resolution time, and existing descriptor restrictions still apply. Calls remain
anchored to the Board's hosting page even when another tab becomes active.

Append `.$describe` to a node path when a board needs the descriptor as structured data rather than
the prose returned by `$help`. The result includes the node's kind, summary, members, and live
children, so a programmatic viewer can build a tree without parsing help text. `$describe` is
available through the same call path and does not invoke the node's methods; use `$help` for the
human-readable explanation. See the [agent board guide](./agents/boards.md) for the descriptor
shape, restrictions, and confirmation rules for boards that expose actions.

Remote `.app` calls use four timeout levels, in order: per-call `timeoutMs`, the remote method's
declared `timeoutMs`, the session-only in-memory `boards.callTimeoutMs`, and the built-in 30-second
fallback. Timeout errors name the selected level and full path. `boards.callTimeoutMs` is not
persisted, and the per-call option affects only a remote `.app` leaf. MCP waits five seconds beyond
the per-call `timeoutMs`; when it is omitted, MCP waits up to 125 seconds total. Pass `timeoutMs` for
a slower call that needs a longer wait.

### `persephone.themes.*` (bridge 1.35.0)

The `themes: true` manifest permission exposes the existing `app.themes` service through a narrow
JSON-only bridge. It does not grant `appScripting` or make other `persephone.call()` paths available.
Without the grant, each method rejects with exactly
`permission-denied: "themes" is not enabled in board-manifest.json`.

```js
const definitions = await persephone.themes.list();
const current = await persephone.themes.current(); // Promise because board calls cross an async transport
const draft = await persephone.themes.fork(current.id);
const preview = await persephone.themes.preview(draft);
await persephone.themes.endPreview();
```

Available methods: `list()`, `get(id)`, `current()`, `derive(base, isDark?)`, `contrast(input)`,
`fork(id)`, `file(id)`, `save(draft)`, `rename(id, name)`, `delete(id)`, `apply(id)`, `preview(draft)`, and
`endPreview()`. Arguments and results are plain JSON values; a missing theme from `get(id)` is
returned as `null`. `file(id)` returns a saved custom theme's stored file — base intent, `isDark`
(`null` = automatic), overrides and id — or `null` for built-ins; use it, not `fork()`, to edit a
saved theme in place. `app.themes.current` remains a synchronous property in the app service, while
the board's `persephone.themes.current()` is a Promise-returning method.

A preview is temporary and restores the latest persisted theme when ended. Closing, reloading, or
navigating away from the requesting frame ends its preview only if no later preview or theme
selection replaced it. Other boards, scripts, Settings changes, cycling, and explicit apply all
replace the preview safely. Boards using this API must declare
`minBridgeVersion: "1.35.0"`.

### A board's own model: `page.editor.app`

A trusted board may publish an AiVision model with `persephone.aiVision.expose(root)`. It then
appears to an agent at `pages[pageId].editor.app`, with its own `$help`, `helpSearch(...)`, normal
hints, writable properties, methods, `elements`, and `highlight(...)`. A declaration made with
`persephone.aiVision.createElements(...)` can name a secondary `view`; highlighting it opens that
board panel and runs in the panel's frame. If no model is published, use the board editor's
`snapshot()` and refs instead. See the [AI Vision guide](./agents/ai-vision.md) for how to publish
one, and the [agent board guide](./agents/boards.md) for the rest of the board authoring surface.

### Page-scoped board UI state: `persephone.pageState`

Use `persephone.state` for small structured values selected to be part of the page descriptor.
Use `persephone.pageState` for larger or opaque board UI data such as response caches, drafts, or
serialized layouts. Values are strings (serialize JSON in the board when useful), each capped at
10 MiB UTF-8. Keys are 1–32 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._-]*`. This app-owned
cache API needs no `fileSystem` permission; keep `readFile`/`writeFile` for board files and
configuration. It requires bridge 1.34.0; declare `minBridgeVersion: "1.34.0"` when the board
depends on it.

```js
const serialized = await persephone.pageState.get("response-cache");
const cache = serialized === undefined ? {} : JSON.parse(serialized);
await persephone.pageState.set("response-cache", JSON.stringify(cache));
await persephone.pageState.remove("response-cache"); // missing keys are fine
```

The host stores these values outside the page descriptor under both the editor id and a stable
board identity. Main and secondary frames share the API, and another board cannot see this board's
same-named key. Values survive app restart, content-host editor switches, and moving the page to
another window. Replacing a simple file-association board deletes its cache; a duplicated page
starts with fresh state. Closing the page removes its page-state cache files through normal editor
cleanup.

Pair the dialog methods with `execute()`: the dialog returns a path, your script does the work:

```js
const path = await persephone.openFileDialog({ title: "Open CSV" });
if (path) {
    const data = await persephone.execute(`node scripts/load.js "${path}"`).getJson();
    renderTable(data);
}
```

### Theme

Persephone injects the app's current theme as CSS variables on `<html>` and keeps them live as the user switches themes:

```css
body { background: var(--p-bg); color: var(--p-text); }
button { background: var(--p-accent); color: var(--p-accent-text); }
```

The board template ships with a `board-base.css` (linked first in `index.html`, copied into every **new** board at creation) that applies sensible defaults — page background, text color, monospace font, themed scrollbars, a themed focus ring, and styled checkboxes — all from `--p-*`. Build your own styles on top.

`board-base.css` also ships an **opt-in "Persephone chrome" layer**: ready-made classes for toolbars and controls, sized and colored to match the app exactly, so a board built from them looks built-in rather than embedded. They fire only when you put the class on an element — a bare `<button>` or `<input>` is untouched, which keeps a vendored library's own controls (av-grid, Flatpickr, Tom Select) styled by their own skin instead.

| Class | What it is |
|-------|------------|
| `.p-toolbar` | 30px chrome bar on `--p-bg-dark` with a bottom rule. Add `data-orientation="vertical"` for a side rail (right border instead, no min-height). |
| `.p-btn` | Button — 26px on a page, 24px inside a `.p-toolbar` automatically. Modifiers: `primary` (the one filled/accent button in a bar), `ghost` (transparent), `danger`, `link`, `selected` (toggled/active state), `icon` (square, for a lone glyph), `sm` (24px anywhere), `md` (keep 26px inside a bar), `on-dark` (toolbar-style fill outside a toolbar). |
| `.p-input`, `.p-select` | Text field / dropdown, sized to line up with `.p-btn` — same 26px / 24px pair and the same `sm` / `md` modifiers. |
| `.p-sep` | Vertical hairline separating toolbar groups. |
| `.p-spacer` | Pushes everything after it to the right edge of the toolbar. |
| `.p-toolbar-title` | Label/caption text inside a toolbar (a board title or breadcrumb, not a control). |

The numbers are ported from the app's own UIKit, so controls come out the same size Persephone uses everywhere else — a fixed height with horizontal padding only; adding vertical padding is the most common way to end up with an oversized bar. The size split matters: Persephone's own editor toolbars are built from *small* (24px) buttons, and the 26px medium size belongs on a page or in a dialog, so a bar of medium buttons looks plausible in isolation and oversized next to the app's chrome. Putting `.p-btn` in a `.p-toolbar` applies the small tier for you. See the **Theming** tab of the Demo board (`assets/demo-board/`) for a live, working example of the whole set.

**Existing boards are unaffected** — this only changes what a **newly created** board's `board-base.css` contains. A board created before this layer was added keeps the copy of `board-base.css` it was created with; copy the file (or its rules) in from a fresh board's template if you want the chrome classes in an older board.

The app's theme shortcuts — **Ctrl+Alt+]** (next theme) and **Ctrl+Alt+[** (previous) — work with focus inside a board, so you can cycle themes to check a board's styling without clicking back into the app first. A board that binds either combination itself takes precedence.

**Full token list:**

| Group | Variables |
|-------|-----------|
| Colors | `--p-bg`, `--p-panel`, `--p-bg-dark`, `--p-overlay`, `--p-hover`, `--p-tree-selection`, `--p-border`, `--p-border-light`, `--p-text`, `--p-text-muted`, `--p-text-strong`, `--p-accent`, `--p-accent-text`, `--p-accent-hover`, `--p-selection-bg`, `--p-selection-text`, `--p-link`, `--p-error`, `--p-success`, `--p-warning`, `--p-scrollbar`, `--p-scrollbar-thumb`, `--p-shadow` |
| Graph colors | `--p-graph-bg`, `--p-graph-node-default`, `--p-graph-node-highlight`, `--p-graph-node-selected`, `--p-graph-node-special`, `--p-graph-border-default`, `--p-graph-border-highlight`, `--p-graph-border-selected`, `--p-graph-border-special`, `--p-graph-link-default`, `--p-graph-link-selected`, `--p-graph-label-bg`, `--p-graph-label-text`, `--p-graph-group-border` |
| Spacing | `--p-space-xs`, `--p-space-sm`, `--p-space-md`, `--p-space-lg`, `--p-space-xl`, `--p-space-xxl` |
| Gap | `--p-gap-xs`, `--p-gap-sm`, `--p-gap-md`, `--p-gap-lg` |
| Radius | `--p-radius-sm`, `--p-radius-md`, `--p-radius-lg` |
| Font | `--p-font-base`, `--p-font-sm`, `--p-font-lg`, `--p-size-icon` |

To render **Persephone-style chrome** (title bars, sidebar panels, grid headers), use `--p-bg-dark` — the app's actual chrome surface, darker than `--p-panel` (which is an input/lighter-surface color) — together with `--p-hover` (hover background for list items/buttons) and `--p-tree-selection` (selected-row background).

**Theme in JavaScript** — for libraries that color themselves from JS (charts, diagrams):

```js
// At init — load-time snapshot (goes stale after a theme switch):
const palette = persephone.theme.vars;    // { "--p-bg": "#...", ... }
const isDark = persephone.theme.isDark;

// Live — always the current theme:
const live = persephone.getTheme().vars;

// React to theme switches:
persephone.onThemeChange(newPalette => {
    chart.update({ backgroundColor: newPalette["--p-accent"] });
});
```

For a canvas-based graph or another drawing that needs concrete colors, use the shaped `graph`
palette. It has `bg`, `nodeDefault`, `nodeHighlight`, `nodeSelected`, `nodeSpecial`, the four
matching `border*` colors, `linkDefault`, `linkSelected`, `labelBg`, `labelText`, and
`groupBorder`. The callback receives the new graph colors too:

```js
persephone.onThemeChange(theme => {
    ctx.fillStyle = theme.graph.nodeDefault;
    ctx.strokeStyle = theme.graph.linkDefault;
    repaint();
});
```

Read `getTheme()` or the `onThemeChange` argument again after every theme switch; the initial
`persephone.theme` value is only a load-time snapshot.

> **Important:** `persephone.theme` is a snapshot taken at page load. After an in-session theme switch it goes stale. Always re-read from the `onThemeChange` callback argument or call `persephone.getTheme()`.

---

## Board folder layout

An ordinary board can live anywhere on disk. Its log is kept in the board folder:

```
My Board/                  ← board root folder (display name = folder name)
  board-manifest.json      ← board identity file (created automatically)
  CLAUDE.md                ← authoring guide (for you or an AI agent)
  ui.log                   ← error log for boards you add — review when something breaks
  index.html               ← entry point (required at the board root)
  app.js                   ← your frontend JS
  style.css                ← your styles
  board-base.css           ← theme defaults (copy from the template)
  scripts/
    hello.js               ← a backend script
```

- `board-manifest.json` is the identity file that tells Persephone this folder is a board. Never delete it.
- The folder name is the board's display name. Rename the folder to rename the board.
- `index.html` at the board root is the only other structural requirement — everything else is your choice.

---

## A board's own documentation — the `guides` folder

A board can ship its **own user and agent documentation** and have Persephone treat it exactly like
the built-in guides. Declare a board-relative folder in `board-manifest.json`:

```json
{
  "schemaVersion": 1,
  "name": "Force Graph",
  "guides": "guides"
}
```

Every `.md` file under that folder is mounted into the app's guide system under
`installed-boards/<board-folder-name>/…`, which means the board's pages show up:

- in the **About page's guide tree**, under the top-level **installed-boards** branch;
- on **F1** from one of the board's own pages (see `editorId` below);
- in **guide search**, so `guides.search("…")` finds the board's text;
- over MCP at `guides["installed-boards/<board>/<page>"]`.

Each page starts with the same front-matter block the app's own guides use:

```markdown
---
title: "Using the Force Graph board"
audience: user
summary: "One sentence shown beside the page in the guide tree."
editorId: "board"
---
```

- `title` and `summary` are required; a page missing them is still shown, but it falls back to its
  file name and an empty summary.
- `audience` is `user`, `agent`, or `both`. `agent` pages are hidden from the guide tree until the
  reader turns on **Show agent guides**, exactly as for the app's own pages — so a board can ship a
  user guide and an agent reference side by side.
- `editorId: "board"` marks the page as the documentation **for this board**, which is what `F1`
  on one of the board's pages opens. It is a fixed token, not the board's real editor id: that id
  embeds the board's absolute path, which differs on every machine.
- `screen` and multi-id `editorId` arrays work the same way as in the app's own guides.

Some rules worth knowing:

- **Trust gates it.** Only a trusted board contributes documentation. Untrusting or removing a
  board drops its pages from the tree and from search immediately, with no restart.
- **The folder must stay inside the board.** An absolute path, a drive letter, or a `..` segment in
  `guides` is rejected and the board simply contributes nothing.
- Name the entry page `index.md` — a folder path opens its index page.
- Documentation shipped this way **versions with the board**, which is the point: it cannot drift
  out of sync with an app release.

---

## Custom editors — associate a board with a file type

A board can register itself as an **editor for a file type**. When you open a matching file, the board appears in the toolbar's editor-switch control right next to the file's normal editor(s) (Text Editor, Grid, Preview, …) — click it to flip between them, exactly like switching between any other pair of editors. Depending on the board's settings, it can also become the **default** editor that opens automatically for that file type.

Declare the association with fields in `board-manifest.json`:

```json
{
  "fileMasks": ["*.drawio"],
  "editorPriority": 100,
  "editorName": "DrawIO",
  "editorKind": "content-host"
}
```

| Field | Purpose |
|-------|---------|
| `fileMasks` | One or more glob masks matched against the file's name — `*` matches any run of characters, `?` matches a single character. A bare extension (e.g. `drawio` or `.drawio`) is treated the same as `*.drawio`. A mask with no wildcard but a dot inside it is an **exact file name** — `"DASHBOARD.md"` claims files named exactly that, not every `.md` file. Masks also support compound extensions, e.g. `*.grid.json`. |
| `contentMasks` | Optional regular-expression sources tested case-insensitively against the page's text. A match adds the board to the editor switch, including on an untitled in-memory page. Content detection is a switch option only: it never chooses the editor that opens a file. A board may use `contentMasks` alone or together with `fileMasks`; only the first 64 KB is checked and invalid expressions are ignored. |
| `folderMasks` | Optional — one or more glob masks matched against the file's *parent folder*, narrowing where `fileMasks` applies. See [Scoping to a folder](#scoping-to-a-folder--foldermasks) below. |
| `editorPriority` | A number that decides whether the board also becomes the **default** editor for matching files (not just a switch option). Persephone's built-in editors each sit at their own priority level; set a value higher than the built-in editor for that file type to make the board the one that opens automatically. Ties go to the first registered match. Omit it (or leave it `0`) and the board is offered only as a switch option — the normal editor keeps opening by default. Built-in priority levels include Text Editor `0`, Markdown Preview `10`, compound-name editors such as `*.grid.json`/`*.note.json` `20`, and the bundled Excalidraw board `50`. For example, a board claiming `.md` files (like the `folderMasks` example below, which uses `fileMasks: ["DASHBOARD.md"]`) needs `editorPriority` **above 10** to open by default — Markdown Preview claims that slot. |
| `editorName` | The label shown for the board in the editor-switch control. Falls back to the board's folder name if omitted. |
| `editorKind` | Optional — `"simple"` (default), `"content-host"`, or `"stream-host"`. A simple board reads/writes a path; a content-host board receives text through `persephone.host.*`; a stream-host board receives an origin-local pipe URL through `persephone.host.streamUrl()` without materialization. |
| `editorSources` | Optional — `"local"` (default, if omitted) or `"any"`. A **simple** board only handles a plain local file by default; set `"any"` to also have it offered for a file inside an archive or at an `http(s)` URL. Persephone copies those non-local sources into a local cache file first, so the board's own code can use `persephone.getFilePath()`. It is the copy-based alternative to `stream-host` and is ignored by content-host and stream-host boards. |

### Inspecting board metadata from scripts

Scripts running on an open board can call `page.editor.getManifest()` after narrowing the editor id
to `board-view` or `board-editor:<id>`. It returns a copied snapshot of the normalized manifest
values Persephone applies; it returns `undefined` if the manifest is missing or malformed. The
snapshot includes the supported manifest fields, including `browserUrlMasks`, `contentMasks`,
`singleInstance`, `settings`, `guides`, and capability `alwaysOpensNewPage`.

Normalization is visible in the returned values. `permissions` are trimmed and deduplicated while
preserving case; browser URL masks are lowercased, deduplicated, filtered, and capped at 64; file
masks are lowercased and bare extensions become globs such as `*.drawio`; folder masks normalize
slashes; content masks omit invalid or overlong expressions. Provider types are trimmed and blank
types removed, while schemes are lowercased and deduplicated. Capability ids, representations, and
titles are trimmed, accepted values are deduplicated, and malformed `alwaysOpensNewPage` values
reject that declaration. Service paths are returned only when they pass the safe board-relative
path check. Settings keep only valid declarations with supported types and defaults; duplicate ids
are first-wins, and enum options are trimmed and deduplicated. Secondary views normalize their text
and omit malformed or duplicate ids. Guides paths are normalized and rejected if unsafe. Empty
`editorName` values are omitted; a declared numeric priority is returned as applied (invalid or
non-positive values become `0`). Other descriptive strings and valid authored enum/boolean values
keep their authored text. Optional fields remain absent when not declared. Nested declarations and
arrays are copies, so changing a returned value does not change the board's manifest or Persephone's
state.

The same snapshots are available to scripts through an open Board Info page's `properties` facade.
That snapshot combines normalized manifest values with Board Info state such as the board root,
trust status, compatibility, and registration issues. See the [Page API reference](./scripting/api/page.md)
for an example using `app.pages.all`.

### Direct-folder boards

Use a manifest such as:

```json
{
  "folderEditorMasks": ["*/projects/*"],
  "folderEditorPriority": 200
}
```

This claims the matching folder itself. In folder mode, `boardRoot` is the folder where the board
app is installed and `folderPath` is the absolute directory the board claims and operates on. Use
`await persephone.getFolderPath()` to read the latter. `getFilePath()` remains `undefined` in folder
mode, and `editorKind: "content-host"` / `"stream-host"` still applies only to a board's file association.

When a trusted board claims a folder, its board icon appears on that folder's File Explorer row and
clicking the row opens the board for the folder. The page toolbar's editor switch offers **Folder
View** and the matching board(s) in the documented order, so you can browse the folder and return to
the board without opening another tab. If the board is later untrusted, an already-open page keeps a
recovery-only switch entry so you can return to Folder View; the board does not run while untrusted.

For example, a board that recognizes force-graph JSON by its content can offer itself for both
saved files and untitled JSON pages without taking over normal file opening:

```json
{
  "contentMasks": ["\"type\"\\s*:\\s*\"force-graph\""],
  "editorName": "Force Graph"
}
```

**Requirements and behavior:**

- **The board must be trusted.** An untrusted board's file association is completely ignored — no switch option, no default-editor behavior — until you trust it. Un-trusting a board removes the association immediately.
- **The tab and icon follow the file, not the board.** When a board is opened as a file's editor, the page tab shows the **file's name** (not the board's folder name). Wherever that board wins as the file's *default* editor, its icon also replaces the generic file icon — in the File Explorer tree, other file lists, and page tabs (see [Board icon](#board-icon)).
- **Unsaved changes are protected.** Switching away from a modified built-in editor to a **simple** board runs the usual "Save changes?" prompt (Save / Don't Save / Cancel) before the switch happens, the same prompt used when navigating away from unsaved changes anywhere else in Persephone. A **content-host** board doesn't need this — its content transfers directly with nothing to lose (see below).
- A change to `fileMasks` / `contentMasks` / `folderMasks` / `folderEditorMasks` / `editorPriority` / `folderEditorPriority` / `editorName` / `editorKind` in the manifest takes effect the next time the board or trust list is refreshed, not while a page is already showing the board.
- **The full set of switch buttons stays visible while the board is active.** Whichever editor is currently showing — the board or one of the file's built-in editors — the same switch buttons appear in the same order, so you can jump directly from the board to any other available editor (e.g. Preview) without detouring through the Text Editor first.

### Scoping to a folder — `folderMasks`

By default, a board's `fileMasks` claim every matching file name, anywhere on disk. `folderMasks` narrows that to files that also sit in a matching folder:

```json
{
  "fileMasks": ["DASHBOARD.md"],
  "folderMasks": ["*/tasks"]
}
```

This claims only a `DASHBOARD.md` that lives directly inside a folder named `tasks` (for example `…/dev/tasks/DASHBOARD.md`) — any other `DASHBOARD.md` elsewhere on disk is left to Monaco (or whichever editor would normally open it).

**Matching rules:**

- Matched against the file's **parent folder**, case-insensitive, and either slash style (`/` or `\`) is accepted.
- A mask is anchored at the **end** of the path — it's a folder-path *suffix*, so it doesn't need to spell out the drive letter or every ancestor folder.
- `*` and `?` stop at a folder separator; `**` crosses them:
  - `*/tasks` — exactly one folder segment above `tasks` (matches `…/dev/tasks`, not `…/dev/sub/tasks`).
  - `tasks` — a folder named `tasks` at **any** depth.
  - `**/dev/tasks` — `dev/tasks` anywhere in the path, with any number of segments in between.
  - `c:/projects/acme/**` — anything under that tree (the tree root itself, `c:/projects/acme`, is not matched — only what's inside it).
- **Narrowing only.** `folderMasks` with no `fileMasks` registers nothing — there's nothing to narrow.
- **Icons follow folder scope when a path is available.** Path-based file lists and local File Explorer rows show a folder-scoped board icon only when the file is inside a matching folder. A name-only icon lookup (including `persephone.icons.forFiles(names)`) cannot check the folder and uses the ordinary file icon for boards with `folderMasks`. The explicit **Open with** menu can still offer a board whose `fileMasks` match, regardless of folder scope; default editor resolution continues to honor `folderMasks`.
- The Board Info page's **"Editor for"** row shows both `fileMasks` and, when present, `folderMasks`, and folder masks are carried through the [published-boards catalog](#published-boards-catalog--discover-install-update) alongside `fileMasks`.

### Simple editors — reading the file directly

This is the default (`editorKind` omitted or `"simple"`): the board reads and writes the associated file itself, directly on disk.

```js
const filePath = await persephone.getFilePath();   // undefined if the board was opened with no associated file
if (filePath) {
    const text = await persephone.readFile(filePath);
    // ... parse and render it ...
}
```

**Local files only.** Because the board handles the file itself, this only works for a real local file — a simple board is never offered as an editor for a file opened over `https://` or from inside an archive.

### Plain board pages — reporting unsaved work

A simple or stream-host board can report its own non-file draft as modified. Only the main board
frame owns this state and the optional Save handler; secondary views cannot register competing
handlers. A dirty page shows the existing tab dot and uses Persephone's Save / Don't Save / Cancel
prompt when it is closed, navigated away from, switched to another editor, or reloaded.

```js
persephone.page.setModified(true);
const offSave = persephone.onSaveRequest(async () => {
    await saveDraft();
    persephone.page.setModified(false);
});
// Call offSave() when this view no longer owns the save action.
```

`onSaveRequest()` handlers may return `false` to keep the page open; a rejected promise, missing
handler, or handler that does not finish within 30 seconds also keeps it open and reports the error.
The latest active registration wins. Persephone clears modified state after a successful release
Save; a board can clear it after a manual save with `page.setModified(false)`. Use this API for a
board-owned draft such as settings or a custom theme. It needs no manifest permission because it
only affects that board page. The API ships with bridge **1.35.0** and does not require another
version bump.

`persephone.onDiscardRequest(handler)` runs when the user chooses **Don't Save**, before the frame is
torn down (best effort, 3 seconds); use it to delete a draft the board keeps in `persephone.pageState`
for app restarts, or the reloaded board would restore the discarded work. It returns an unsubscribe
function and takes effect only while an `onSaveRequest` handler is registered.

Window/app close does not prompt. Persist non-file drafts in board-local storage and call
`page.setModified(true)` again after restoring a draft. For example, a Theme Editor should save and
apply its theme in the registered handler, and clear modified only after both operations succeed.

This differs from a **content-host** editor: Persephone owns that file's pipe, auto-save cache,
dirty state and file-save prompt. Use `persephone.host.setContent()` and `persephone.host.save()`
for that file rather than the plain-board draft API.

### Content-host editors — sharing Persephone's file with the board

Set `"editorKind": "content-host"` and Persephone builds the board **with the same file-handling machinery every built-in editor uses** — the content pipe, encoding detection, encryption, the auto-save cache, and dirty/unsaved-changes tracking (the tab's unsaved dot, the "Save changes?" prompt). The board never touches the disk directly; it works through a bridge instead:

```js
// Render the current content, and re-render whenever it changes externally
render(await persephone.host.getContent());
persephone.host.onContentChange((content) => render(content));

// Write a change back — marks the file modified and schedules the auto-save cache
persephone.host.setContent(newContent);

// Optional: the Monaco language id of the current content (e.g. "xml", "json")
const language = await persephone.host.getLanguage();
```

`persephone.host` is only meaningful on a content-host board — on a **simple** board, `getContent()`/`getLanguage()` reject (instead of hanging forever) and `onContentChange()` simply never fires, so feature-detect if your board needs to support either kind.

Three things a content-host board can do that a simple board cannot:

- **Works beyond local files.** It can open a file served over `https://`, an entry inside an archive, or an **encrypted** file — none of which a simple board supports.
- **Shares content live with other editors.** Switching from a content-host board to the Text Editor (or Grid) and back hands over the same live content, with no reload and no data loss. Edit the raw text in Monaco, switch back and the board re-renders from the edit; edit in the board and switch to Monaco to see it reflected there.
- **Works on an untitled page.** Create a new page and rename its tab to a name matching the board's `fileMasks` (e.g. `diagram.drawio`) — the board appears in the switch control right away, even though the page has never been saved to disk. Switch to the board and back without losing anything. A simple board can't do this: it reads and writes the file path directly, so it needs a file that already exists on disk.

**Same chrome as the built-in editor it replaces.** A content-host board's editor-switch control offers the exact same options its file's built-in editor would — including **Text Editor** (Monaco) even when the file's natural built-in viewer is something else (for example, a board for `*.drawio` files shows `Text Editor | Drawio`, matching what a built-in viewer for that file type would show). The board also gets the same footer row a built-in text editor shows: a **script** toggle that opens the [Script Panel](./scripting/index.md#script-panel) to run a script against the file's content, and the file's encoding with a provider icon (local file, HTTP, or Mneme).

**Footer status text:** any board can put its own text in its footer bar — call `persephone.setStatusText(text)` with any string, e.g. a **Todo board** (a published board that replaces Persephone's former built-in Todo editor — see [What's New](./whats-new.md)) showing its `"12 items"` count. Call it from the board's main view; pass `""` to clear it. A **simple** board has the footer too (without the script toggle and encoding). Guard the call with `persephone.setStatusText?.(…)` if the same board also targets older Persephone builds.

**Footer status-bar items:** boards that require bridge version `1.27.0` can also use
`persephone.statusBar.set()` to add transient text labels and buttons beside the footer indicators.
Items can be updated by id, hidden for later reuse, and aligned to the end of the board contribution
area. The legacy `setStatusText()` label remains in its existing position.

**Page-toolbar text:** a trusted or bundled board's main view can call
`persephone.toolbar.setText(text)` to replace the wide middle label in the page toolbar. This is
separate from the content-host footer status: it works for plain and content-host boards and is
transient and non-persistent. **The slot starts empty**: it used to show the board's folder path
when no board had claimed it, which spent the toolbar's whole flexible span on something the user
had just chosen and could not act on. So `persephone.toolbar.setText("")` now clears the slot
rather than restoring that path. The label remains non-interactive, and while a board's text is
shown its native tooltip carries the full path. Reloading, navigating away, a frame error, or
losing trust clears the text; the newly mounted frame must set it again. It is safe to call
`setText()` (and `toolbar.set()` / `update()`) from top-level script code: calls made while the
page is still loading are held and applied, in order, once it has loaded.

**Saving:** press **Ctrl+S** (or **Cmd+S**) anywhere in the board and Persephone saves the file through the pipe automatically — no board code required. A board that wants to handle the keystroke itself can call `event.preventDefault()` in its own key handler to opt out, in which case the automatic save stands down. `persephone.host.save()` is also available if you want to trigger a save from your own UI (e.g. a Save button).

**Example:** the DrawIO diagram viewer board renders a `.drawio` file's XML read via `persephone.host.getContent()`, and re-renders whenever `onContentChange()` fires. Switch to the Text Editor to hand-edit the raw XML — switching back to the board re-renders the diagram from your edits immediately — and Ctrl+S saves through the pipe with no board code at all.

### Stream-host editors — ranged pipe URLs without a materialized file

Set `"editorKind": "stream-host"` when the board needs binary or media access without receiving
text or a local cache path. Persephone owns the pipe and gives the board an origin-local URL:

```js
const url = await persephone.host.streamUrl();
const response = await fetch(url, { headers: { Range: "bytes=0-1048575" } });
console.log(response.status, response.headers.get("Content-Range"));
```

`streamUrl()` is available to both `stream-host` and `content-host` pages and returns
`board://<host>/__pipe/<pageId>`, which supports `Range`. A stream-host page does not write its
source to disk. This is a broker policy, not an OS guarantee: memory may be paged and Chromium may
keep its own caches. `editorSources: "any"` solves the same non-local problem by copying the source
into a cache file and returning that local path from `getFilePath()`.

The pipe can range-read platform providers, and a board provider that implements `readRange`
receives bounded ranged pulls without a whole-resource `readBinary()` first. A provider that omits
`readRange` keeps the buffered `readBinary()` fallback and its 256 MiB ceiling. Content reads have
no platform deadline; cancellation, including page teardown or a superseded request, releases the
outstanding operation.

---

## Published boards catalog — discover, install, update

Persephone maintains a small **catalog of boards published by the project** — ready-made custom editors and tools you can install without building them yourself. The flagship example is the **PDF Viewer** board — it replaced Persephone's former built-in PDF viewer (see [Editors — PDF Viewer](./editors/index.md#pdf-viewer)), so PDF viewing is now a ~3.5 MB opt-in download instead of ~21 MB of pdf.js shipped to every installation. Other examples include a `.drawio` diagram viewer. The catalog is refreshed automatically in the background (roughly once a day) and can also be refreshed on demand.

### Discovering a board

- **From a file** — open a file whose type has no editor installed yet, but that matches a published board's file type. The editor-switch control at the top of the page shows an extra **+** entry next to **Text** (`Text | +`). Click it to open the **Board Info** screen for that board (or, if more than one published board matches the file type, a screen listing all of them).
- **From a folder** — open a folder whose path matches a published board's direct-folder claim. The folder page's editor-switch control shows **+** after the available folder editors. Click it to open **Board Info**, which lists the matching board and its folder mask. The folder remains in Folder View until you download and register the board.
- **From the hub** — open the **Tools & Editors** panel (App menu) and click **Open in new tab**, or open its **Search boards** tab directly. This full-page **Search boards** tab browses the whole catalog — filter by name, description, or file type — and works without any matching file open. A **Refresh catalog** button forces an immediate check instead of waiting for the next automatic cycle.

Each board's card in the **Search boards** tab shows a **screenshot** of the board alongside its name, version, size, description, and file types, so browsing the catalog looks like a gallery rather than a text list. The **Board Info** screen shows the same screenshot, in both its install and its properties view. A board with no screenshot — or a screenshot that can't be loaded (for example while offline) — shows a neutral placeholder in its place, so cards stay the same size either way. The catalog listing itself is cached and browsable offline, but screenshots are loaded from the internet on demand, so they fall back to the placeholder until you're back online.

### Installing a board — Download, then Register

Installing a published board is always two separate, explicit steps — nothing is ever trusted or executed on your behalf:

1. **Download** — the Board Info screen shows the board's name, version, description, file types or folder claim, and download size, plus an install-location field (defaults to a Persephone data folder; **Browse…** to choose another). Clicking **Download** fetches the ZIP with a byte-progress bar, verifies its checksum, and extracts it to disk. **Nothing is trusted yet** — the downloaded board sits inert on disk, exactly like any other folder of files. This is the point at which you (or your AI agent) can open the folder and read its scripts before deciding to trust it.
2. **Register board** — once downloaded, the screen shows **"Downloaded — not registered"** with the folder's path and a reminder that you can ask your AI agent to review the board's files first. Clicking **Register board** shows the same **Trust board** dialog every board shows on first use (see [Board trust gate](#board-trust-gate) above). Only after you accept does the board become active — the file or folder you opened switches to the new editor automatically, and the switch control now shows it (`Text | <Board Name>` or `Folder View | <Board Name>`) instead of `+`.

You can delete a downloaded-but-not-yet-registered board directly from this screen — nothing was ever trusted, so there's nothing to untrust.

### Board properties, updates, and rollback

Once a board is installed, the same **Board Info** screen switches to a **properties** view — reached from the **Boards** tab, the in-board toolbar's **… → Board properties**, the hub, or an update notification. It shows the board's description, author, install location, file-type association, trust state, and installed version, plus:

- **Versions** — the board's full published version history, newest first, fetched on demand. The version you have installed is marked **Current**; a newer compatible version is highlighted. Click **Update** (or **Install** on an older entry) to switch to that version — the swap is safe: your existing folder is only replaced once the new version has downloaded and verified successfully, so a failed download or a cancelled update never leaves you with a broken board. A version that needs a newer Persephone than the one you're running is shown disabled with a **"Requires Persephone ≥ X"** hint.
- **Uninstall** — removes the board's folder from disk and forgets it (untrust + unpin). This only appears for boards installed from the catalog; a board you (or an agent) created locally shows **Unregister** instead, which only forgets it — the folder is kept.
- **Open board** — switches back to the board itself.

**Update notifications:** when a compatible newer version is published, installed boards get a silent **"Update available"** badge in the **Boards** tab (with an **Update** action in its context menu) and a small dot on the board's in-board **…** button — no pop-up interruptions, just a quiet indicator you can act on when convenient.

If a board you're updating is currently open (or has background processes still running via `setBoardBusy`), Persephone asks you to close its pages first, with a **Close pages & continue** shortcut that does it for you (respecting any unsaved changes) and proceeds with the update.

> Updating or rolling back a board replaces its files, including any local edits you made by hand — there's no separate warning for that beyond the click itself.

### Checking for new boards

Persephone checks the catalog automatically, but you can force an immediate check from two places:

- The **Search boards** tab's **Refresh catalog** button.
- The **About** page's **Check for Updates** button — it now refreshes both the app-update check and the boards catalog in one click, and the About page shows an **Available boards** count reflecting the current catalog. See [Checking for Updates](./getting-started.md#checking-for-updates).

### Security model

The same trust rule that governs every board applies here without exception: **a board never runs anything until you explicitly click Register/Trust.** Downloading a board only copies verified, inert files to disk — no script runs, and it isn't offered as an editor until registered. This means you (or your AI agent, on your behalf) always have a window to inspect a downloaded board's files before deciding whether to trust it. See [Board trust gate](#board-trust-gate) for the trust dialog itself.

### Driving it from a script or AI agent

An AI agent can perform the whole discover → download → review → install → update lifecycle through the scripting API, with the same one-click trust rule holding throughout — nothing is trusted without the trust dialog, and a well-behaved agent reviews and reports rather than deciding for you. It should trust a board only when you have asked it to.

| Method | Description |
|--------|-------------|
| `app.boards.list()` | List local trusted, installed, and open board roots. Read-only; does not query the remote catalog. |
| `app.boards.searchPublished(query?)` | Search the catalog by name/description/file type; each result is annotated with its install state. Read-only, no dialog. |
| `app.boards.getPublishedVersions(id)` | A board's full version history. Read-only, no dialog. |
| `app.boards.downloadPublished(id, opts?)` | Download + verify + extract a board **without trusting it** — the "can I trust this board?" entry point: download it, read its files, then decide. No dialog. |
| `app.boards.installPublished(id, opts?)` | Opens the Board Info screen for an interactive install (or drives an update/rollback if already installed and `opts.version` is given). |
| `app.boards.uninstallBoard(id)` | Removes an installed catalog board, after the usual delete confirmation. |
| `app.boards.checkPublishedUpdates(force?)` | Refresh the catalog and report which installed boards have an update available. No dialog. |
| `app.boards.registerBoard(boardRoot)` | Show the trust dialog for a board already on disk (e.g. one downloaded with `downloadPublished`); resolves to whether it ended up trusted. |
| `app.boards.unregisterBoard(boardRoot)` | Untrust a board (no dialog — untrusting only removes privilege). |
| `app.boards.renameBoard(boardRoot, newName)` | Rename a trusted board's folder, carrying its trust, pin, and catalog registration to the new path. |

See the [Scripting API Reference](./scripting/api/app.md#boards) for full method signatures, and ask your AI agent to `persephone://guides/boards` for the complete authoring/automation reference, including a checklist for reviewing a downloaded board's files before registering it.

> **Publishing a board to the catalog?** A `board-manifest.json` can declare `"screenshot": "screenshot.png"` (a file name, not a path) to give the board a screenshot on its catalog card and Board Info page. This only applies to boards published through the `persephone-boards` project — see that repository's own documentation for the full publishing contract.

---

## Secondary views — a board's own sidebar panel

A board isn't limited to the single main view in its tab. It can declare one or more **secondary views** — extra pages that show up as sidebar panels next to the board, kept in sync with the main view automatically. This is how an editor-style board offers a companion panel such as "Lists", "Outline", or "Details" alongside its main content, the same way built-in editors like the Notebook editor pair a main list with a sidebar panel.

- Secondary views are declared by the board itself (in its `board-manifest.json`, or added/removed while it runs) — there's nothing to configure as a user.
- Each declared view opens as its own sidebar panel while the board's tab is active, with the title the board gave it (its icon always matches the board's own icon).
- The main view and every secondary panel share state, so selecting something in a sidebar panel (e.g. picking a list) can instantly filter or update what the main view shows, and vice versa.
- Some of what a board puts in that shared state is remembered across app restarts and board reloads (a per-board author choice), so a selection you made can still be there next time you open the board.
- Closing the board's tab, or navigating it to something else, closes its secondary panels along with it — they aren't a way to keep the board running in the background (see [Long-running processes](#long-running-processes-setboardbusy--getboardbusy--getjobs) for that).

> **Building a board with secondary views?** See the board's own `CLAUDE.md` (or `persephone://guides/boards` for an AI agent) for the full `persephone.state.*` and `persephone.setSecondaryViews` reference. The bundled **Demo board** includes a working example.

---

## Environment variables — secrets outside the board folder

A board should never store secrets — connection strings, API keys, passwords — inside its own folder, because that folder is exactly what gets copied, shared, or committed to a repo. Persephone instead keeps a single, optional password-encrypted `.env.json` file **outside every board's folder**, with each board reading and writing only its own slice of it.

### What this does and doesn't protect

For a board with object-form permissions, the bridge limits the operations it can request. A board
granted `execute`, `fileSystem: "full"`, or another **Full access** permission can still reach
sensitive resources, so review its grant list before trusting it. Legacy boards without an object
permissions declaration remain unrestricted during the deprecation period. This storage feature
solves:

1. **Secrets no longer live in the shareable board folder.** Copying, zipping, or committing a board no longer leaks its connection strings.
2. **Optional password encryption protects the file at rest** if the machine or the file itself is stolen.

Per-board isolation keeps each board's variables in its own slice. Permission grants still govern
what the board can do through Persephone; a board with broad grants may be able to access secrets
through other means. The [board trust dialog](#board-trust-gate) shows its requested grants.

### Configuring the storage location

Open **Settings** and find the **Board Environment Variables** section:

| Control | Description |
|---------|-------------|
| Path display | Shows the configured `.env.json` path, or "Not configured yet". |
| **Browse...** | Point the setting at an already-existing `.env.json` file — a plain native Open File dialog. Nothing is created or overwritten. |
| **Create...** | Choose a path (defaults to Persephone's data folder) and create a new, empty file there. |
| **Unlink** | Clear the setting. The file itself is left untouched on disk. |
| **Open Environment Variables** | Opens the configured file in its built-in editor (disabled until a path is configured). |

If no path is configured yet, the first time any board calls `persephone.var.*` you'll instead see a one-time **"Create environment variables storage"** dialog with an editable default path — declining it makes that call fail (a well-behaved board handles this gracefully).

Encryption is entirely optional and reuses Persephone's existing file-encryption feature — encrypt or decrypt the `.env.json` file the same way you would any other text file, from its tab's right-click menu. The first time a board (or the editor) needs to read an encrypted, not-yet-unlocked file, Persephone prompts once per session for the password.

### The `.env.json` editor

Opening a `.env.json` file (from Settings, the File Explorer, or File → Open) shows a dedicated editor instead of raw JSON:

- **Left pane** — every namespace (board) currently stored in the file. Click one to select it; add a new namespace or delete an existing one from here.
- **Right pane** — profile tabs for the selected namespace (`default`, plus any custom profiles a board has written, e.g. `dev`/`qa`), and below them a grid of that profile's variable names and values. Values are shown in plain text — there's nothing to mask on your own local machine.
- Add, edit, or delete variables directly in the grid — range-select, copy/paste, and add-row all work the same as any other Persephone grid.
- Press **Ctrl+S** (or navigate away) to save; the file re-encrypts automatically on save if it was encrypted.
- A locked (encrypted, not-yet-unlocked) file shows an **Unlock** button instead of its contents.

### How a board reads and writes its own variables

From inside a board's own script (`app.js`):

```js
// Read one value (the "default" profile, unless env is given)
const server = await persephone.var.get("SNOWFLAKE_SERVER");

// Write a value into this board's OWN namespace
await persephone.var.set("SNOWFLAKE_USER", "my-user");

// List this board's variable names (not values) in a profile
const keys = await persephone.var.list();

// A named profile other than the default, e.g. "dev"
const devServer = await persephone.var.get("SNOWFLAKE_SERVER", "dev");

// Open the environment variables editor, scoped to this board
await persephone.var.show();
```

- `persephone.var.get(name, env?)` / `.set(name, value, env?)` / `.list(env?)` are always scoped to the **calling board's own namespace** — a board never passes a namespace, so it has no way to name and reach another board's variables.
- **Every call is async and can reject**: storage not configured and you declined to create it, the file is locked and you cancelled or entered the wrong password, or a store error. A board should handle rejection gracefully (e.g. show its own "please configure your connection" message) instead of assuming the call always succeeds.
- A board's namespace is its manifest's `author`/`name` (e.g. `"Persephone/Excel Viewer"`) when **both** fields are explicitly set in `board-manifest.json`; otherwise it falls back to the board's own root folder path. Changing `author`/`name` later re-namespaces the board and orphans its previously-stored variables — keep them stable once secrets are stored under them.

### Namespace collisions at registration

Two different boards can end up with the same `author`/`name` — for example, a developer's working copy of a board and its installed copy from the catalog. Registering (trusting) a board whose namespace already matches an already-registered board shows an advisory dialog naming the other board, with:

- **Register Anyway** — proceed; both boards will share the same stored variables.
- **Cancel** — stop, so you can give the new board a distinct `author`/`name` in its manifest before registering it again.

This only happens for `author`/`name` namespaces — a board using its root-path fallback can never collide with another board.

### Letting an AI agent configure a board's secrets for you

An agent can provision a board's environment variables ahead of time — for example, right after scaffolding a board that needs a database connection — using the `app.boardVars` scripting namespace, which (unlike `persephone.var.*`) can target **any** namespace:

```js
const root = await app.boards.createBoard("Snowflake Viewer", "C:/boards");
const namespace = await app.boardVars.namespaceFor(root);
await app.boardVars.set(namespace, "SNOWFLAKE_SERVER", "abc123.snowflakecomputing.com");
await app.boards.openBoard(root);
```

This means you can ask an agent to "build me a board that connects to Snowflake" and have it scaffold the board **and** configure its connection secrets in one go, without opening the `.env.json` editor by hand yourself. See [app.boardVars](./scripting/api/app.md#boardvars) for the full method reference.

---

## Board icon

Place an `icon.svg`, `icon.png`, or `icon.ico` in the board folder to set a custom icon. The icon appears in the page tab (when the board is open), the **Boards** Explorer panel, and the **Boards** tab of the Tools & Editors panel/hub. SVG is preferred; first match wins. Without an icon file, a default board glyph is shown.

If the board is also a [custom editor](#custom-editors--associate-a-board-with-a-file-type) and wins as a file type's **default** editor, its icon replaces the generic file-type icon everywhere that file type is listed — the File Explorer tree, other file lists, and page tabs — not just when the board itself is open.

---

## Error log (`ui.log`)

Board errors — including script and load failures — are appended to `ui.log`. The log also records
`console.error` and `console.warn` from the board, service output, and warnings or errors sent
through `persephone.notify()`. Choose **Open board log** from the in-board toolbar's **…** menu
to review it. Ordinary boards keep the file in their board folder; bundled boards keep it at
`%APPDATA%\persephone\board-logs\<id>\ui.log`.

Opening or reloading a board adds a `----- board loaded -----` separator, so earlier entries remain
available across reloads. The log is limited to 256 KiB; when it grows beyond that, older entries
are removed to make room. Keep `catch` blocks in your board JS calling
`persephone.notify(message, "error")` so failures are captured there.

---

## Offline-first and the CSP

A board's Content Security Policy (`connect-src 'self'`) blocks remote resources such as CDN scripts, stylesheets, fonts, and cross-host browser `fetch()`. For intentional remote HTTP requests, a trusted board can call `persephone.fetch(url, init)`, optionally with `{ tor: true }` or `{ proxy: "host:port" }`. This API sends only the headers you provide, is not subject to browser CORS, and returns a standard `Response`. **Download all component libraries into the board folder** and reference them with relative paths:

```html
<!-- Correct: relative path to a local copy -->
<script src="./lib/av-grid.umd.js"></script>

<!-- Wrong: blocked by CSP -->
<script src="https://cdn.jsdelivr.net/..."></script>
```

This keeps the board self-contained and offline-ready — it works with no network connection and is unaffected by CDN changes.

---

## Recommended components

Persephone publishes a catalog of components recommended for boards, with a pre-built **skin** (CSS or JS adapter) that restyles each component to match the app's `--p-*` theme. The catalog lives in the [`boards-assets/`](../boards-assets/) folder in the repository.

| Component | Use | Skin type |
|-----------|-----|-----------|
| [av-grid](https://github.com/andriy-viyatyk/av-grid) | **Data grid — the default.** Sort, filter, search + highlight, range select, clipboard, editing | none needed |
| [Tabulator](https://tabulator.info/) | Data grid — fallback, for grouping, tree data, pagination, export, variable row heights, … | CSS |
| [Chart.js](https://www.chartjs.org/) | Line, bar, pie, radar, scatter charts | JS adapter |
| [Flatpickr](https://flatpickr.js.org/) | Date / time / range picker | CSS |
| [Tom Select](https://tom-select.js.org/) | Rich select, tags, autocomplete | CSS |
| [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/) | Markdown render with syntax highlighting | CSS |
| [Mermaid](https://mermaid.js.org/) | Diagrams from text (flowchart, sequence, Gantt, …) | JS adapter |
| [Split.js](https://split.js.org/) | Resizable layout panes | CSS |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-to-reorder lists and kanban boards | CSS |
| [Tippy.js](https://atomiks.github.io/tippyjs/) | Tooltips, popovers, dropdown menus | CSS |
| [Native `<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) | Modal dialogs — no library needed | CSS |

**To use a skin:**
1. Download the component's JS (and CSS if needed) into the board folder under `lib/`.
2. Copy the matching skin file from `boards-assets/` into the board folder as your own local copy.
3. Link the component's CSS first, then the skin CSS (the skin overrides the defaults). For JS adapters, load the adapter after the library and before your `app.js`.

The `boards-assets/manifest.json` file has machine-readable details — vendor URLs, tested versions, and skin type notes — that an AI agent can use to automate the setup.

**For tabular data, av-grid is the default.** It is a port of Persephone's own internal grid, so it matches the app's built-in grid editors, needs **no skin** (it reads the `--p-*` variables directly, so a theme switch re-tints it with no code), and renders more smoothly than Tabulator — noticeably so even on small tables. Tabulator remains in the catalog for the features av-grid does not have: variable row heights, row grouping, tree data, nested column headers, pagination, footer calculations, built-in export, remote data loading, row drag-reorder, undo/redo, and its library of ready-made cell formatters.

> **Skins are not guaranteed.** Each skin is stamped with the component version it was tuned for (e.g. `tabulator-tables@6.5.1`). If you vendor a newer version, test the board and patch your local copy where needed.

---

## AI-assisted board authoring

Boards are designed to be authored by an AI agent. The key workflow:

1. **Create or open a board.** Use the `boards.createBoard` or `boards.openBoard` call paths. Boards
   created this way are auto-trusted — no trust prompt blocks the agent.
2. **Discover the board** through `pages`; boards report `editor: "board-view"`, a
   `selectedBoard`, and (for standalone boards) a `boardRoot`.
3. **Read `CLAUDE.md`** inside the board folder — it documents the bridge API, theme contract,
   recommended-components catalog, and authoring conventions. The
   `persephone://guides/boards` resource contains the board authoring reference.
4. **Edit files** and call `pages[pageId].editor.reload()` to pick up changes. Boards do not reload
   automatically; after reloading, call `pages[pageId].editor.snapshot()` to inspect the result.
5. **Test the board** using `pages[pageId].editor`:

```
pages["abc"].editor.snapshot()
pages["abc"].editor.click({ ref: "e12" })
pages["abc"].editor.evaluate("document.querySelector('#result').textContent")
```

Mouse and keyboard actions use trusted input and check that targets are visible and actionable.
Snapshots can be limited to interactive items or scoped to a board region. See the
[page automation reference](./scripting/api/page.md#browser-board-and-window-page-automation)
for locators, waits, page events, response inspection, and the shared operation list.

`pages["abc"].editor.evaluate(...)` is useful for testing `persephone.execute()` from the agent
side without modifying source files.

### Board call paths

| Call path | Parameters | Description |
|-----------|------------|-------------|
| `boards.createBoard` | `name`, `dir`, `demo?` | Create a board in `<dir>/<name>`; returns `boardRoot` and auto-trusts the result. |
| `boards.openBoard` | `path` | Open an existing board and return its page id and title. |
| `pages[pageId].editor.reload` | none | Reload a board after editing its files; returns the refreshed frame state. |
| `persephone://guides/boards` | — | Board authoring and review reference. |

---

## Managing boards

| Action | How |
|--------|-----|
| Create a board | **Boards** panel → **New board** (or caret → **Create Demo board**) |
| Create a board (script) | `await app.boards.createBoard("Name", "C:/path/to/dir")` |
| Open a board from Explorer | Click the **Open Board** button on a `board-manifest.json` row |
| Open a board from the Boards panel | Click the board in the **Boards** Explorer-sibling panel |
| Open a board in a new tab (keep it running) | Right-click the board in the **Boards** panel → **Open in New Tab** |
| Keep a board's spawned processes running after navigating away or reloading | Board calls `persephone.setBoardBusy(true)` — see [Long-running processes](#long-running-processes-setboardbusy--getboardbusy--getjobs) |
| See which boards have processes still running in the background | Look for the green **running** dot next to the board name in the **Boards** panel |
| Open a board from the sidebar | **Tools & Editors** panel → **Boards** tab → click the board |
| Open a board (script) | `await app.boards.openBoard("C:/path/to/board/root")` |
| Open File Explorer from inside a board | Click the **File Explorer** button (folder icon) in the in-board toolbar |
| Reload the board | In the in-board toolbar, open **…** → **Reload board** |
| View the error log | In the in-board toolbar, open **…** → **Open board log** |
| Pin a board | In the **Boards** tab, hover the board row and click the pin button |
| Copy a board's folder path | Right-click the board in the **Boards** Explorer panel, or in the sidebar's **Boards** tab / the hub's **Registered boards** tab → **Copy board path**, or right-click an open board page tab → **Copy Board Path** |
| Open a board's folder as a workspace page | Right-click the board in the **Boards** Explorer panel, or in the sidebar's **Boards** tab / the hub's **Registered boards** tab → **Open board folder**, or right-click an open board page tab → **Open Board Folder**. The new page's File Explorer is rooted at the board folder. |
| Remove / untrust a locally-created board | Right-click the board in the **Boards** tab → **Remove** |
| Delete a locally-created board | Right-click in the **Boards** Explorer panel → **Delete Board** |
| Rename a locally-created board | Rename the board's folder in the file system (Explorer, terminal, or the File Explorer sidebar), or ask an AI agent to rename it (`app.boards.renameBoard`) |
| Discover & install a board published by the project | Open a matching file and click **+** in the editor switch, or open the **Search boards** tab of the Tools & Editors hub — see [Published boards catalog](#published-boards-catalog--discover-install-update) |
| Update an installed catalog board | **Boards** tab → **Update available** badge / context menu, or the dot on the board's **…** button |
| Roll back an installed catalog board to an older version | Board's **Properties** screen → **Versions** list → **Install** on the older version |
| Remove an installed catalog board (deletes its folder) | Board's **Properties** screen → **Uninstall** |

---

## Demo board

The Demo board (`"Create Demo board"`) is a full working example that demonstrates:

- Buffered `execute()` — fetching JSON from a backend script
- Streaming `execute()` — a long-running script with live output
- Stdin / kill — sending input and stopping a process
- The integration tier — `notify`, `openFileDialog`, `openRawLink`
- A declared `service.mjs` — lazy supervision, no-page requests, shared `persephone.storage`, and visible lifecycle status
- The `--p-*` theme contract and JS token access
- A multi-tab layout with a pinned output console

Read its `index.html`, `app.js`, and `style.css` for a rich authoring reference — they are extensively commented.

The Demo board is created in the folder and with the name you specify in the **Create Demo board** dialog. The source template lives at `resources/assets/demo-board/` inside the Persephone installation folder (or at `assets/demo-board/` in the repository).
