---
title: "Boards — services, shared storage and content providers"
audience: agent
summary: "Declared module services, shared storage, service-backed content providers, and browser-download URL claims."
---

# Boards — services, shared storage and content providers

## Declared services and shared storage

| `executeNode()` | Declared `service` |
|---|---|
| Board-page child process, started by the page and normally scoped to its frame. | Platform-started utility process, started lazily and supervised; it can run with no board page open. |

For this service-versus-`executeNode()` process-ownership choice, use the guidance in this section.
Choose `executeNode()` for work initiated by the visible board page: it starts with the page and
its process normally ends with the frame. Choose a declared `service` for background or
platform-owned work that must survive a page reload, serve requests with no board page open, or
have supervised lifecycle status. A service is platform-started lazily in a utility process and
can use `persephone.storage` for shared per-board JSON state.

A manifest may declare a board-relative ESM entry and its bridge requirement:

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": { "execute": false, "service": true, "fileSystem": false, "openExternal": false, "appScripting": false, "network": false, "clipboardRead": false, "camera": false, "microphone": false, "computerAudio": false, "geolocation": false, "notifications": false, "themes": false },
  "service": "scripts/service.mjs"
}
```

The service runs in Persephone's bundled utility-process Node runtime with the board root as its
cwd. Standard Node built-ins (filesystem, networking, streams, crypto, workers, and timers) are
available; `electron`, `app`, `BrowserWindow`, `webContents`, and `ipcMain` are not. Imports resolve
from the board root, including its `node_modules`. The environment is sanitized to the supervisor
allowlist plus `PERSEPHONE_SERVICE=1`, `PERSEPHONE_BOARD_ROOT`, and `PERSEPHONE_LOCALE`.
`PERSEPHONE_LOCALE` is the resolved Persephone UI locale at service spawn, including regional codes
such as `pt-BR` and the verification locale `en-XA`; a service that starts before the first renderer
reports its locale receives the initialized `en` default. The host updates
`process.env.PERSEPHONE_LOCALE` in place whenever the effective app locale changes, without
restarting the service. Read the variable when needed, such as inside each request handler, rather
than caching it at startup. This process environment value does not require a new
`minBridgeVersion`; the page-only `persephone.locale.code` and `persephone.i18n` APIs still require
Bridge 1.36.0. A board that depends on this service locale contract must set
`minAppVersion: "5.0.15"`. The host injects
`persephone.storage`, shared with the frame and routed through main; a service must not open
`store.json` itself. Service stdout/stderr is written to the board's `ui.log`. Ordinary boards
store it at `<boardRoot>/ui.log`; bundled boards store it at `<userData>/board-logs/<id>/ui.log`.
The selected application profile determines `userData`.

For a resident backend tied to the visible page, `executeNode()` can also keep one long-lived
script open and exchange JSON lines over stdin/stdout. This avoids starting a new child for each
operation; use `setBoardBusy(true)` if it must survive a reload, then re-attach by `name` with
`getJobs()`:

```js
const srv = persephone.executeNode("scripts/db-server.js", [dbPath], { name: "db" });
srv.on("stdout", chunk => handleJsonLine(chunk));   // {id, columns, rows} | {id, error}
srv.write(JSON.stringify({ id: 1, sql }) + "\n");   // per query — db stays open
```

## Service-backed content providers

Declare `contentProviders: [{ "type": "acme/mem", "schemes": ["mem"] }]` in the manifest and
implement the matching type inside the module service with
`persephone.providers.register(type, implementation)`. This registration is service-only because
the implementation contains functions that cannot cross the board frame's structured-clone RPC.
The implementation supplies `readBinary(config)` and may supply `readRange(config, range)`,
`writeBinary(config, data)`, `stat(config)`, `status(config, emit)`, and `watch(config, onChange)`;
`status` and `watch` return disposers. `readRange` is optional: when present, the provider receives
bounded ranged pulls (at most 1 MiB per call) as `Uint8Array` results; when absent, the pipe falls back to whole-resource
`readBinary()` buffering, capped at 256 MiB. `readBinary()`, `readRange()`, and `stat()` have no
platform deadline. Only reads are exempt from the shared control-request cap; `stat()` still counts
against it. `writeBinary()`, `watchSubscribe()`, and `watchUnsubscribe()` use the service request
deadline. Cancellation releases pending requests, such as on page or frame teardown.

An implementation may also supply `status(config, emit)` to report transient provider status.
Call `emit(snapshot)` with `{ state, text?, detail?, progress?, rate? }`, where `state` is
`idle`, `connecting`, `active`, `done`, or `error`; progress is `{ loaded, total? }` in bytes and
rate is bytes per second. Return a disposer that stops status production. Status is observed while
the provider is in use and is not persisted with the page's pipe descriptor.

Provider types must contain `/` because un-namespaced types are reserved for the platform. The
type is persisted in page state, so renaming it orphans old pages. Types and schemes are
one-owner, first-trusted-board-wins registrations; a loser and its owner are reported in Board
Info. New independent registration issues produce a toast once; unchanged issues do not toast again
on refresh. Reserved schemes are `http`, `https`, `file`, `data`, `blob`, `mneme`, and every
`persephone-*` name. Provider registration is service-owned; there is no `contentProviders`
permission flag. The service requires `service: true`.

From the frame, send structured-clone messages and handle lifecycle rejection:

```js
const reply = await persephone.service.request({ op: "index", value: input });
await persephone.storage.set("last-reply", reply);
```

Requests start the service lazily and can reject with `untrusted`, `permission-denied`,
`service-busy`, `service-timeout`, `service-exited`, or `service-failed`. From the host renderer,
`app.boards.requestService(root, message)` reaches the same service with no page open;
`app.boards.startService(root)` explicitly starts and resets its restart budget, and
`app.boards.stopService(root)` tears it down. Read `app.boards.list()` and inspect the matching
`service` object (`state`, `reason`, `pid`, `startedAt`, `restartCount`) after every lifecycle
observation. For the Demo board, create it with `app.boards.createDemoBoard(name, dir)`, find its
`pageId` under `pages`, use `pages[pageId].editor.snapshot()` and the Service tab's controls, then
use `boards.list()` to confirm the result. A full renderer reload is script-driven with
`script.execute("setTimeout(() => location.reload(), 50); return 'reloading'")`; the editor's
`reload()` only reloads the board iframe.

Register the new host-managed protocol at module top level:

```js
persephone.service.onRequest(async (message) => handleRequest(message));
persephone.service.onShutdown(async ({ reason }) => closeResources(reason));
```

`onRequest` accepts one handler, passes through the caller's structured-clone message, and uses
its return value as the response. An early request with no handler gets
`{ code: "service-handler-not-registered", message }`. Rejections preserve a non-empty
`error.code` and readable message; `persephone.service.request()` rejects with an Error whose
`.code` is available to the board. Calls that lack the board's `service` grant reject with
`.code === "permission-denied"`; the error message remains the manifest grant explanation.
Entry import failure is logged and does not send `ready`.
Shutdown callbacks run sequentially in registration order, all are attempted, and any failure
makes the host exit nonzero. The main process allows 2 seconds for shutdown. Do not register raw
`process.parentPort` message listeners together with this API: raw mode takes ownership of
lifecycle and request replies, and `onRequest` is ignored. Unmigrated raw services remain supported
during the transition.

For page-to-service streaming, a board opens a channel with `await
persephone.service.openChannel(openMessage)`. The service's single `onChannel` handler receives
`(channel, openMessage, info)`; same-board `info` contains `page: { boardId }`, while cross-board
opens also include `interface: { id, version }` and descriptive `caller: { id, name }`. A channel
supports `send`, `onMessage`, `onClose`, `close`, `writable`, and `whenWritable()` on both sides.
The channel preserves FIFO order and caps each direction at 256 unacknowledged messages; only
service-to-page payloads also have a 1 MiB serialized-size cap. At most 16 channels can belong to
one frame and 128 to one service. Wait for capacity before sending:

```js
if (!channel.writable) await channel.whenWritable();
channel.send({ type: "update", value });
```

`send()` can throw `channel-backpressure`; an oversized service-to-page payload throws
`payload-too-large`, and non-cloneable values throw `rejected`. Close reasons identify reload, service exit, trust loss, and app quit.

## Browser-download URL claims

`browserUrlMasks` is a manifest axis separate from `fileMasks`. `fileMasks: ["*.torrent"]`
associates local file names; it does not claim matching Browser downloads. A board intending both
must declare both:

```json
{
  "fileMasks": ["*.torrent"],
  "browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
}
```

The normalizer trims, lowercases, de-duplicates, and bounds the declaration to 64 masks of 512
characters each. Matching is case-insensitive against the whole URL and is anchored at both ends.
Therefore `*://*/*.torrent` matches `https://example.test/a.torrent` but misses
`https://example.test/a.torrent?dl=1`; keep the query-form mask beside it.

This path applies only to Browser downloads, before the save dialog; it does not intercept ordinary
navigation. A live run confirmed that a match cancels the download, sends its source URL to
`openRawLink` with the winning board target, creates no save path or download entry, and notifies the
user with the board name.

For a claim made by a Tor or Incognito page, the platform fetches the URL through the originating
Electron session. The session handle stays host-side and is never sent through the board bridge or
stored in a provider descriptor. Bridge 1.24.0 exposes only a Boolean fact: the initial source is
marked by `persephone.source.initialSourcePrivateSession` alongside `persephone.getSourceUrl()`,
and later source events from `persephone.source.onOpen(callback)` carry `privateSession: true` when
applicable. No event field is sent for ordinary sessions. A board that needs a source-specific
explanation owns that UI; for example, a torrent board can explain that only the claimed source
fetch uses the page's session, while tracker and peer connections are not routed through Tor and
swarm peers can see the user's real IP.

For source-panel opens, `persephone.source.initialSourceContext` contains the bounded snapshot
captured from the Explorer folder or Link Editor category/tag that opened the initial source. Its
`kind`, `sourcePath`, raw `category`/`tag`, `label`, ordered non-directory `items`, and `index` let a
board seed a sibling queue; link items also include `id`, `category`, and `tags`. Later
`source.onOpen()` events carry their own `context` snapshot, captured for that specific open before
single-instance routing. Both snapshots describe the source at open time; each is limited to 5,000
items and 1 MiB of serialized UTF-8. The initial context is part of `sourceLink` and is restored by
page persistence (`PagesPersistenceModel.saveState()` serializes the descriptor through
`appFs.saveDataFile()`). Runtime event context is not persisted by the host, so a board that needs
later accepted items after restart must save them in its own restorable state.

```js
const initialContext = persephone.source.initialSourceContext;
persephone.source.onOpen(({ sourceUrl, context }) => {
    if (context) addQueueSources(context.items, context.index, sourceUrl);
});
await persephone.source.navigate(initialContext.items[nextIndex].href);
```

`source.navigate(href)` accepts only an href in the page's initial `source.initialSourceContext.items`
and only when that context came from Explorer or a Link Editor category/tag panel. It updates that
panel's selection and navigates the page hosting the board; it cannot navigate another page.

Only trusted boards and enabled bundled boards contribute claims. Trusted roots register before
bundled boards; an exact normalized duplicate is refused and reported as a
`browser-url-mask` registration issue, while distinct overlapping masks keep their order and the
first matching claim wins. These eligibility and collision rules protect registry correctness.
Trust controls whether a board runs; its object-form permission flags separately gate bridge
capabilities.

For a torrent viewer, persist a self-contained link so the provider can restore without its board
page. The `torrent/viewer` provider receives the complete href in `config.url`:

```text
torrent://<40-lowercase-hex-infohash>/<encodeURIComponent(normalized-file-path)>?magnet=<encodeURIComponent(magnet-uri)>
```

Normalize paths to `/` and encode the normalized path as one URL path value. The provider owns
WebTorrent piece selection and prioritisation; its optional `readRange(config, range)` returns
bounded `Uint8Array` replies (at most 1 MiB), never a stream.
