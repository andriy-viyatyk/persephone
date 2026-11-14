---
title: "Boards — the bridge: busy state, page state and own model"
audience: both
summary: "setWorking, setBoardBusy and long-running processes, a board's own model on page.editor.app, and persephone.pageState."
---

# Boards — the bridge: busy state, page state and own model

## Transient tab activity: `setWorking()`

Boards can report whether the agent for the **selected session** is currently working. This shows a
ring and orbit on the board page's tab icon, including while the page is inactive. It is visual
status only: it does not keep the page, iframe, or spawned processes alive. The signal starts false
and resets when the board frame reloads or is replaced, so announce the selected session's current
state again after startup or reload.

Feature-detect the additive API when supporting older Persephone versions:

```js
if (typeof persephone.setWorking === "function") {
  persephone.setWorking(true);  // selected session's agent starts working
  // ...when that selected session stops working:
  persephone.setWorking(false);
}
```

Call it for the selected session's agent transitions only. `setWorking()` is separate from
[`setBoardBusy()`](bridge-state.md#long-running-processes-setboardbusy--getboardbusy--getjobs), which controls
whether spawned processes survive a board unload.

## Long-running processes: `setBoardBusy()` / `getBoardBusy()` / `getJobs()`

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

**Related but different:** opening a board with **Open in New Tab** (see [below](getting-started.md#2-open-an-existing-board)) keeps the whole board — iframe and all — alive in its own tab. `setBoardBusy()` is for the opposite situation: you replaced the board's tab with something else (or reloaded it) and only need its *processes*, not the board UI, to survive.

## A board's own model: `page.editor.app`

A trusted board may publish an AiVision model with `persephone.aiVision.expose(root)`. It then
appears to an agent at `pages[pageId].editor.app`, with its own `$help`, `helpSearch(...)`, normal
hints, writable properties, methods, `elements`, and `highlight(...)`. A declaration made with
`persephone.aiVision.createElements(...)` can name a secondary `view`; highlighting it opens that
board panel and runs in the panel's frame. If no model is published, use the board editor's
`snapshot()` and refs instead. See the [AI Vision guide](../agents/ai-vision.md) for how to publish
one, and the [agent board guide](../agents/boards/index.md) for the rest of the board authoring surface.
If the board frame reloads while an AiVision request is pending, that request rejects with the
message `"The board frame was reloaded."`.

## Page-scoped board UI state: `persephone.pageState`

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
