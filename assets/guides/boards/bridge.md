---
title: "Boards — the bridge: execute, executeNode and services"
audience: both
summary: "window.persephone basics: execute and executeNode for backend scripts, and declared services, storage and lifecycle."
---

# Boards — the bridge: execute, executeNode and services

## The board bridge — `window.persephone`

The only Persephone-specific API a board sees is `window.persephone`. Everything else is plain web development.

Host requests can reject with an `Error` that has a readable `.message` and may also have a stable
`.code`. If the user removes the board's trust while a request is in progress, the request rejects
immediately with `code === "untrusted"` and the message `"This board is no longer trusted."`.
Registering the same callback twice with one listener API creates one subscription; either returned
unsubscribe function removes it. Main-port requests still pending when the board page closes or
navigates away reject with `"The board page closed or navigated away."`, so handle that error where
shutdown can interrupt your work.

### `persephone.execute(commandLine, options?)`

Runs a command on your machine and returns a process handle:

```js
// Options: cwd (default = board folder), env, shell, name
const handle = persephone.execute("node scripts/load.js");
```

This starts an ordinary OS process with your user privileges. `execute` and `executeNode` processes
can use Node filesystem and network APIs directly; the board frame's `fileSystem` and `network`
grants do not sandbox them. See [board trust and permissions](trust-and-permissions.md#service-declarations-in-board-manifestjson).

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

`persephone.execute("node script.js")` only works if the **user's machine** happens to have Node installed — a board you build (or one someone else installs from the [published catalog](published-boards.md#published-boards-catalog--discover-install-update)) can't rely on that. `executeNode` instead runs the script on **Persephone's own bundled Node runtime** — the same Node build the app itself ships with — so it works on any machine with **zero setup**, no Node or Python install required:

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

The [board authoring guide](../agents/boards/services.md#declared-services-and-shared-storage)
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
The environment is sanitized to the supervisor allowlist plus `PERSEPHONE_SERVICE=1`,
`PERSEPHONE_BOARD_ROOT`, and `PERSEPHONE_BOARD_DATA`. This process environment value points to
`%LOCALAPPDATA%\Persephone\board-data\<id>` on Windows, or
`~/.config/persephone/board-data/<id>` by default on Linux. Named profiles and test instances use
their own `<userData>\board-data\<id>` path. Persephone does not create the board folder; the board
creates it on first write. If the variable is absent, use the legacy Windows path. Named profiles
start empty with no migration; users may copy an individual board folder by hand. This
does not add a `window.persephone` member. Service stdout and stderr are captured in the board's
`ui.log`. For
boards you add, that file is `<boardRoot>/ui.log`; bundled boards keep it at
`%APPDATA%\persephone\board-logs\<id>\ui.log` on Windows or
`~/.config/persephone/board-logs/<id>/ui.log` by default on Linux (or the named profile folder).

The `service` permission controls whether this process may start; the frame's `fileSystem` and
`network` permissions control host bridge APIs and do not sandbox the service. Its ordinary Node
filesystem and networking APIs run with your user privileges. `network: false` therefore does not
mean a service is offline. See [board trust and permissions](trust-and-permissions.md#service-declarations-in-board-manifestjson).

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
`app.boards.list()` as `service.state`, `reason`, `pid`, `startedAt`, and `restartCount`.

The host-managed service also exposes the settings declared by its own board. Reads use the same
manifest defaults, stored-value validation, and board namespace as the page API:

```js
const instructions = await persephone.settings.get("instructions");
const stop = persephone.settings.onChange(({ id, value }) => {
    if (id === "instructions") reloadInstructions(value);
});
// Call stop() when this listener is no longer needed.
```

`onChange()` returns a disposer. One renderer subscription is shared by all local callbacks, and
changes include the effective default after a reset. The service can read settings when no page for
its board is open. Settings remain renderer-owned; main routes service requests to a ready renderer
and scopes them to the service's trusted board with its existing `service` grant. This API is part
of bridge **1.42.0**. It is available to the host-managed service API; legacy raw-protocol entries
do not receive it.

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
