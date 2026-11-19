---
title: "app: Processes and Boards"
audience: user
summary: "How do scripts run processes and work with boards?"
---

# app: Processes and Boards

## proc

Spawn external programs and stream their output. Each call to `execute()` returns a handle — consume it either **one-shot** (buffer stdout to completion) or **streaming** (attach event listeners). Do not mix both modes on the same handle.

```javascript
// One-shot: run a script and parse its JSON output
const data = await app.proc.execute("python scripts/load.py").getJson();

// One-shot: capture plain text output
const output = await app.proc.execute("git log --oneline -10").getText();

// Streaming: render output as it arrives
const h = app.proc.execute("npm run build");
const dec = new TextDecoder();
h.on("stdout", (chunk) => console.log(dec.decode(chunk)));
h.on("exit", ({ code }) => console.log("Done, exit code:", code));

// With options: custom cwd and env
const result = await app.proc.execute("node index.js", {
    cwd: "C:/my-project",
    env: { DEBUG: "1" },
}).getText();
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `execute(command, options?)` | `IExecuteHandle` | Spawn a command line and return a process handle. The command runs through the OS shell by default (so `&&`, pipes, and inline arguments work). |

### IExecuteOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `cwd` | `string?` | app cwd | Working directory for the spawned process. |
| `env` | `Record<string, string>?` | — | Extra environment variables, merged over the inherited environment. |
| `shell` | `boolean \| string?` | `true` | Shell to use. `true` = OS default; a string picks a specific shell (`"bash"`, `"pwsh"`); `false` = run the executable directly without a shell. |
| `name` | `string?` | — | Optional job name. Mainly used by [Boards](../../boards/bridge-state.md#long-running-processes-setboardbusy--getboardbusy--getjobs), where a busy board re-associates its surviving jobs by name after a reload. |

### IExecuteHandle

| Member | Description |
|--------|-------------|
| `jobId` | Unique ID for this job. |
| `getText()` | Buffer stdout to completion and decode as UTF-8 text. Rejects only on a spawn-level error. |
| `getJson(pattern?)` | Buffer stdout, then `JSON.parse`. Rejects on spawn error, non-zero exit, or parse failure with a `RunnerError` (`err.name === "RunnerError"`) carrying `exitCode` and `stderr`. Pass a `RegExp` to extract JSON from noisy output (the last match is used; capture group 1 if present). |
| `getBytes()` | Buffer stdout to completion and return the raw `Uint8Array`. |
| `on("stdout" \| "stderr", cb)` | Stream binary chunks as they arrive. Attaching a listener switches to streaming mode (one-shot getters then throw). Returns an unsubscribe function. |
| `on("exit", cb)` | Fires once when the process exits. Callback receives `{ code, signal }`. |
| `on("error", cb)` | Fires once on a spawn-level failure (process never started). |
| `write(data)` | Write to the process's stdin (`string` or `Uint8Array`). |
| `endStdin()` | Close the process's stdin. |
| `kill(signal?)` | Terminate the process (default `"SIGTERM"`). |

---

## boards

Create and open [Boards](../../boards/index.md). Boards created via this API are scaffolded from the built-in template, get a `board-manifest.json` identity file, and are **auto-trusted** — they open without a trust prompt.

```javascript
// Create a blank board in any folder and open it
const root = await app.boards.createBoard("My Board", "C:/work/boards");
await app.boards.openBoard(root);

// Create from the Demo template (rich annotated example)
const root = await app.boards.createDemoBoard("Demo", "C:/work/boards");
await app.boards.openBoard(root);

// Open an existing board by its root path
await app.boards.openBoard("C:/work/boards/Existing Board");
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `createBoard(name, dir)` | `Promise<string>` | Create a blank board named `name` inside container folder `dir` (created if needed). Returns the new board's absolute root path. Throws if a board named `name` already exists in `dir`. |
| `createDemoBoard(name, dir)` | `Promise<string>` | Same as `createBoard`, but scaffolds from the bundled Demo board template — a full working example of the bridge API, theme contract, and multi-tab layout. Returns the board root. |
| `openBoard(boardRoot)` | `Promise<void>` | Open an existing board by its absolute root folder path (the folder containing `board-manifest.json`). Opens a new tab or reuses an existing one. Boards created by Persephone open immediately; foreign boards prompt for trust. Throws if `boardRoot` is missing or has no `board-manifest.json`. |
| `list()` | `Promise<BoardListing[]>` | List local trusted, installed, and open boards. Read-only and does not contact the remote catalog. |
| `requestService(boardRoot, message)` | `Promise<unknown>` | Send an opaque structured-clone message to the board's declared service, starting it lazily when needed. Rejects with a readable lifecycle reason such as `untrusted`, `service-not-declared`, `service-busy`, `service-timeout`, `service-exited`, or `service-failed`. |
| `startService(boardRoot)` | `Promise<void>` | Explicitly start the board's declared service and reset its restart budget. |
| `stopService(boardRoot)` | `Promise<void>` | Explicitly stop the board's declared service. |
| `registerBoard(boardRoot)` | `Promise<boolean>` | Trust an existing board on disk — shows the user a trust dialog; nothing is trusted without that click. Resolves to whether the board ended up trusted (`true` also when already trusted, including via a trusted ancestor folder). Use after downloading/reviewing a board. |
| `unregisterBoard(boardRoot)` | `Promise<void>` | Untrust a board and remove its pin. No dialog — untrusting only reduces privilege. Idempotent. |
| `renameBoard(boardRoot, newName)` | `Promise<string>` | Rename a board's folder, carrying its trust, pin, and catalog-install registration to the new path with no dialog, and re-pointing any open page for it. Returns the new root. Throws if the board is busy, not a board, or the new name already exists. |

### Published boards catalog

Persephone ships against a small **catalog of boards published by the project** (ready-made custom editors and tools — see [Boards — Published boards catalog](../../boards/published-boards.md#published-boards-catalog--discover-install-update)). These methods let a script or AI agent drive the whole discover → download → review → install → update lifecycle, always through the same one-click trust rule as the rest of the API — a script can download and inspect a board, but only the user's dialog click can trust it.

```javascript
// Find a published board, download it for review, then ask the user to trust it
const results = await app.boards.searchPublished("drawio");
const root = await app.boards.downloadPublished(results[0].id); // no trust yet
// ...inspect the files at `root`...
const trusted = await app.boards.registerBoard(root); // shows the trust dialog

// Interactive install/update/rollback via the Board Info screen
await app.boards.installPublished("drawio-viewer");
await app.boards.installPublished("drawio-viewer", { version: "1.0.0" }); // rollback

// Check for updates and uninstall
const updates = await app.boards.checkPublishedUpdates(true);
await app.boards.uninstallBoard("drawio-viewer");
```

| Method | Returns | Description |
|--------|---------|-------------|
| `searchPublished(query?)` | `Promise<PublishedBoardResult[]>` | Search the catalog by name/description/file mask; each result includes `version` (the latest catalog version) and is annotated with install state (`installed`, `installedVersion`, `updateAvailable`, `compatible`). Read-only, no dialog. |
| `getPublishedVersions(id)` | `Promise<PublishedVersionResult[]>` | A published board's full version history (newest first), each entry annotated with `compatible` and `installed`. Read-only, no dialog. |
| `downloadPublished(id, opts?)` | `Promise<string>` | Download + verify (sha256) + extract a board to disk and record it in the install registry — **no dialog, no trust**. The board sits inert on disk, ready to review. `opts: { dir?, version? }`. Returns the install root. |
| `installPublished(id, opts?)` | `Promise<string \| undefined>` | Interactive install: opens the Board Info page for **Download → Register** (fresh install) or auto-runs a version swap (update/rollback) if `id` is already installed and `opts.version` is given. Resolves the root, or `undefined` if the user abandons it. |
| `uninstallBoard(id)` | `Promise<boolean>` | Uninstall a catalog-installed board: shows the delete confirmation, then removes its folder, trust, pin, and install-registry entry. |
| `checkPublishedUpdates(force?)` | `Promise<BoardUpdateInfo[]>` | Refresh the catalog and return installed boards with a compatible newer version available. No dialog. |

`list()` returns one entry per locally known board. Each entry has `root`, optional manifest
`name`/`description`, `trusted`, optional `installed` metadata (`id`, `version`, and known update
information), and `openPageIds`. A board with a registered module-service status also has an
optional `service` object with `state` (`stopped`, `starting`, `running`, `stopping`, or
`failed`), an optional `reason`, `restartCount`, and optional process fields `pid` and
`startedAt` (epoch milliseconds). Boards without a registered service status omit the key. It does
not discover boards from the remote catalog.

---

