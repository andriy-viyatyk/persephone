---
title: "Boards — the execute channel, themes bridge and page state"
audience: agent
summary: "persephone.execute and executeNode, the themes bridge, page visibility, page-scoped UI state, transient activity and long-running processes."
---

# Boards — the execute channel, themes bridge and page state

## The `persephone.execute()` channel

Every `execute()` and `executeNode()` call requires `execute: true`; the blank starter keeps it
false until the author chooses to run a process.

```js
const handle = persephone.execute(commandLine, { cwd, env, shell }); // cwd defaults to the board folder
```

Options: `cwd` defaults to the board folder; `env` adds environment variables; `shell` (a
boolean or a shell path, like Node's `child_process.spawn`) runs the command through a shell —
set `true` to enable pipes, globbing, and other shell features.

Consume the handle **one** of two ways (mixing them on one handle throws):

- **Buffered** — `await handle.getText()` / `getJson()` / `getBytes()`. `getJson()` rejects on a
  non-zero exit or parse error (the error carries `exitCode` + captured `stderr`).
- **Streaming** — `handle.on("stdout"|"stderr", chunk => …)`, `handle.on("exit", info => …)`,
  `handle.on("error", err => …)`, plus `handle.write(...)`, `handle.endStdin()`, `handle.kill()`.

**Convention:** a backend script prints a single JSON document to stdout; the page reads it
with `getJson()`. When a script shells out to other tools that also print, send diagnostics to
**stderr** and wrap the result in a marker the page extracts:

```js
console.log("@@RESULT@@" + JSON.stringify(result));               // backend (node)
const result = await persephone.execute(cmd).getJson(/@@RESULT@@(.*)/); // page extracts last match
```

## `persephone.executeNode()` — guaranteed Node runtime

`execute("node script.js")` only works if the **user** has Node installed — a published
board can't assume that. `executeNode` runs a script on **Persephone's own bundled Node
runtime**, so it works on any machine with zero dependencies:

```js
const handle = persephone.executeNode(script, args?, { cwd, env, name }); // script relative to the board folder
```

- `script` — relative to the board folder (or absolute); prefer **`.mjs`** for explicit ESM
  (boards ship no `package.json`). `args` is a `string[]` passed **argv-style, no shell** (no
  quoting hazards); the `shell` option is ignored. A missing script fires the handle's `error`.
- Returns the **same handle** as `execute()` (buffered / streaming / `write`/`endStdin`/`kill`
  / `name`-based `getJobs()`). Runtime is **Node 24** with **`node:sqlite` built in** (incl.
  FTS5) — SQLite with no npm install.
- **Resident-server pattern:** spawn one long-lived script and feed it JSON lines over stdin
  instead of spawning once per operation. Pair with `setBoardBusy(true)` to survive a reload and
  re-attach by `name` via `getJobs()`.

```js
const srv = persephone.executeNode("scripts/db-server.js", [dbPath], { name: "db" });
srv.on("stdout", chunk => handleJsonLine(chunk));   // {id, columns, rows} | {id, error}
srv.write(JSON.stringify({ id: 1, sql }) + "\n");   // per query — db stays open, no re-spawn
```

For the `executeNode()` versus declared-service ownership choice, see
[Declared services and shared storage](services.md#declared-services-and-shared-storage).

## The `persephone.themes` bridge

Boards that request `themes: true` can call `list()`, `get(id)`, `current()`, `derive(base, isDark?)`,
`contrast(input)`, `fork(id)`, `file(id)`, `save(draft)`, `rename(id, name)`, `delete(id)`, `apply(id)`,
`preview(draft)`, and `endPreview()`. Every method returns a Promise over the existing `app.themes`
service. The board method `persephone.themes.current()` is asynchronous because its request crosses
the board transport; `app.themes.current` remains a synchronous property. To edit a saved custom
theme in place, read it with `file(id)` (stored base intent, `isDark`, overrides and id; `null` for
built-ins) rather than `fork(id)`, which pins every derived base color.

Only plain JSON arguments and cloned JSON results cross the bridge. `get(id)` returns `null` when the
theme is absent. A missing permission rejects with exactly
`permission-denied: "themes" is not enabled in board-manifest.json`. This route is separate from
`persephone.call()` and does not grant access to other app paths.

`preview(draft)` applies a temporary preview without saving it. `endPreview()` restores the latest
persisted theme. The host also ends a frame's preview on close, reload, or navigation away, but only
while the preview generation still belongs to that frame. A newer board or script preview, explicit
apply, Settings selection, or theme cycle replaces it and survives stale frame cleanup.

Remote `.app` calls use the same four-level host timeout policy: a per-call `timeoutMs`, the
remote method's declared `timeoutMs`, the session-only in-memory `boards.callTimeoutMs`, then the
30-second built-in fallback. The selected level and full path are included in a timeout error;
`boards.callTimeoutMs` is not persisted. The per-call option applies only to a remote `.app` leaf.
<!-- board-template:exclude -->For MCP calls, the server waits five seconds beyond a supplied per-call `timeoutMs`; if omitted,
it waits up to 125 seconds total.<!-- /board-template:exclude --> Pass `timeoutMs` for a slower operation that needs more time.

### A board's own model: `.app`

A trusted board may publish an AiVision model with `persephone.aiVision.expose(root)`. When it does,
the model appears at `pages[pageId].editor.app`. This is the board's own named model, not another
view of Persephone's page or editor facade: use its `$help`, `$describe`, or `helpSearch(...)` to discover the
board's members and normal hints, then read or write its declared properties, call its methods,
inspect `elements`, or use `highlight(...)`. A declaration made with
`persephone.aiVision.createElements(...)` can
name a secondary `view`; highlighting it opens that board panel and runs in the panel's frame.

The todo board from the board catalog (1.1.0 and later) is the worked example for this pattern: its `.app` model exposes lists,
tags, items, actions, and named controls in both the main view and a secondary view. Remember that
`expose()` probes `index(0)` once to derive the shape of an indexed item. If a board registers while
an asynchronous load still leaves its collections empty, it must call the returned remote's
`refresh()` when they first become non-empty; otherwise `items[0]` (and other indexed items) will
not resolve for an agent. `refresh()` republishes the shape and tells the host that the board's
model changed, so read `pages[pageId].editor.app` again after the resulting `shape-changed` event.
The returned remote also provides `notify(text)` for a short board-authored message:

```js
const remote = persephone.aiVision.expose(model);
remote.notify("The import finished.");
```

Only trusted boards can deliver this message to the agent. It is one line, at most 512 characters,
and accepted board notifications are limited to five per rolling minute in the renderer window.
The event is shown to the agent as board-written. `notify(text)` is separate from
`persephone.notify(text, type)`, which remains a board toast. Agent-facing methods must also
complete without waiting for an in-board confirm dialog; use an immediate method path and leave
confirmation to the interactive UI.

The `.app` member is optional. If the board exposes nothing, use `snapshot()` and the returned refs
as the fallback for driving its rendered UI.

When you are the one **building** the board, <!-- board-template:exclude -->[AI Vision](../ai-vision.md)<!-- /board-template:exclude -->
(`guides.agents["ai-vision"]`) is the authoring reference for publishing this model: the descriptor
contract, `createElements`, the `refresh()` shape rule, and the constraints an agent-facing method
must respect.

## Page visibility

`persephone.page.visible` reports whether the hosting page is the active page or is grouped beside
the active page. It is initialized from the board handshake and does not depend on whether the app
window is minimized. Subscribe to changes with `onVisibilityChange`; it immediately calls the
callback with the current value and returns an unsubscribe function:

```js
const unsubscribe = persephone.page.onVisibilityChange((visible) => {
  player.setVisible(visible);
});
```

## Page-scoped UI state: `persephone.pageState`

Use `persephone.pageState` for larger or opaque UI data that should stay outside the page
descriptor. `get(key)` returns a string or `undefined`; `set(key, value)` stores a string; and
`remove(key)` succeeds when the key is already absent. JSON serialization is an option for
structured values. Keys are 1–32 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._-]*`; each
value is limited to 10 MiB UTF-8. It requires no `fileSystem` permission. Keep descriptor-backed
`persephone.state` for small selected values and file APIs for board files/configuration.
This API requires bridge 1.34.0; declare `minBridgeVersion: "1.34.0"` when the board depends on it.

```js
const serialized = await persephone.pageState.get("response-cache");
const cache = serialized === undefined ? {} : JSON.parse(serialized);
await persephone.pageState.set("response-cache", JSON.stringify(cache));
await persephone.pageState.remove("response-cache");
```

Page state is isolated by stable board identity, including when content-host switches reuse an
editor id. Main and secondary frames share it; it survives restart, content-host editor switches,
and cross-window moves. Switching a simple file-association board away deletes its state; duplicate
pages start independently; closing the page removes its cache files.

## Transient tab activity: `setWorking()`

For an agent UI that follows a selected session, call `persephone.setWorking(true)` when that
session's agent starts and `persephone.setWorking(false)` when it stops. Feature-detect the method
to support older Persephone versions:

```js
if (typeof persephone.setWorking === "function") {
  persephone.setWorking(isSelectedSessionAgentWorking);
}
```

This animates the board page's tab icon, even while the page is inactive. It is transient visual
status only and does not retain the page, iframe, or processes. It resets on frame reload or
replacement; announce the selected session's current state again after startup/reload. This is
independent of `setBoardBusy()`, which controls process survival across board unloads.

## Long-running processes: `setBoardBusy()` / `getBoardBusy()` / `getJobs()`

By default everything a board spawned is **killed when the board unloads** (page navigated
to a document, or a board reload). A board that starts processes that must keep running
(dev servers, watchers) opts out with the busy flag:

- `persephone.setBoardBusy(true)` — while busy, unloading the board keeps its processes
  running. They are still killed on page/tab close, app quit, or after `setBoardBusy(false)`
  + unload.
- `persephone.getBoardBusy()` → `Promise<boolean>` — survives the board's own reload; read on
  startup to re-enter "running" mode.
- `persephone.getJobs()` → `Promise<[{ jobId, command, name, kill(), write(), endStdin() }]>` —
  this board's live jobs, including ones from a previous board lifetime. Surviving jobs are
  control-only (no stdout/stderr/exit streaming; output produced while unloaded is dropped).

**Author pattern** — name long-running jobs and reinitialize on startup (the board's JS state
does not survive a reload, only the flag and the processes do):

```js
persephone.execute("npm run dev", { name: "backend" });   // start
persephone.setBoardBusy(true);

if (await persephone.getBoardBusy()) {                     // every board startup
    const jobs = await persephone.getJobs();
    const backend = jobs.find(j => j.name === "backend");
    if (backend) showRunning(backend);                     // Stop → backend.kill()
    if (jobs.length === 0) persephone.setBoardBusy(false); // nothing lives — reset
}
```
