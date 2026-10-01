# US-1591: Electron fuses + asar integrity; board Node scripts off `ELECTRON_RUN_AS_NODE`

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F5 · **Medium**

## Goal

The released `persephone.exe` can no longer be used as a general-purpose Node runtime, and its
`app.asar` can no longer be edited in place. This means locking the Electron fuses in
`electron-builder.yml`.

`ELECTRON_RUN_AS_NODE` has one consumer, a board's `persephone.executeNode()`. Before that fuse can
go off, `executeNode()` moves to an Electron `utilityProcess`, and its handle contract stays the
same.

## Background

### Today (verified 2026-10-01)

- **Fuses:**
  - No `electronFuses` key in `electron-builder.yml`, so every fuse keeps its Electron default.
  - electron-builder 26.15.3 supports `electronFuses` (`node_modules/app-builder-lib/out/configuration.d.ts:235`, `FuseOptionsV1` at `:475-525`).
  - electron-builder flips the fuses right before signing (`platformPackager.js`, `doAddElectronFuses`).
  - It embeds the Windows asar integrity resource by itself (`ElectronFramework.js:49-50` → `electronWin.js` `addWinAsarIntegrity`), unless `disableAsarIntegrity` is set.
  - `@electron/fuses` 1.8.0 is present as electron-builder's dependency.
- **Production load:**
  - The production window loads `index.html` with `loadFile` (`src/main/open-window.ts:237`), so it runs on `file://`.
  - `grantFileProtocolExtraPrivileges` must therefore stay at its default (on).
- **Main-process networking:**
  - It all goes through Chromium (`net.fetch` / `session.fetch`: `board-download-service.ts:56`, `published-boards-service.ts:205,260`, `version-service.ts:23`, `tor-service.ts:354`, …).
  - So turning off the `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` fuse does not change the app's own TLS.
- **The only `ELECTRON_RUN_AS_NODE` user** is `src/main/board-bridge.ts:360-372`, the `RunnerChannel.start` handler:
  - It rewrites a `node: true` start (from `board-shim.ts:1653-1657`, `executeNode`) to `command: process.execPath, args: [script, ...args]`.
  - It sets `env: { ...opts.env, ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1" }` and `shell: false`.
  - It then calls `startJobTo` in `src/main/command-runner.ts`.
  - Nothing else in `src/`, `launcher/`, `snip-tool/` or `assets/` relies on run-as-node. There are no `child_process.fork` calls. The workers are `worker_threads`.
- **`command-runner.ts`:**
  - `Job.proc` is a `ChildProcessWithoutNullStreams`.
  - `treeKill` runs `taskkill /PID <pid> /T /F` on Windows.
  - Output is coalesced and flushed on `close`, then `exit` is sent.
  - `writeJobStdin`, `endJobStdin`, `killJob`, `getJobsBySinkIds`, `reapJobsBySinkId` and `killAllCommands` all go through `activeJobs`.
- **Existing `utilityProcess` pattern:** `module-service-supervisor.ts:379` forks `getAssetPath("module-service-host.mjs")` with `cwd`, `env`, `stdio: "pipe"` and `serviceName`.
- **`executeNode` consumers:**

| Consumer | What it uses |
|---|---|
| `persephone-boards/boards/sqlite-viewer/scripts/db-server.mjs` | Resident server: `readline` over `process.stdin`, `process.argv[2]`, `import.meta.url`, `process.exit` |
| `assets/demo-board/scripts/node-probe.mjs` | Plain script; must exit by itself |
| `assets/demo-board/scripts/node-server.mjs` | `process.stdin.setEncoding` + `on("data")`, exits on `end` |

### `utilityProcess` behavior (prototyped 2026-10-01 against this repo's Electron 43 / Node 24.17)

1. **stdin cannot be piped.** The `stdio` option accepts only `ignore` for stdin. `process.stdin` is one fixed `Readable`: the getter is non-configurable, so it can't be replaced, and its state is already `ended`, so any reader sees `end` at once.
   - Re-running the stream constructor on that object, `Readable.call(process.stdin, { read() {} })`, resets it to a fresh, open stream.
   - After that, `push(chunk)` and `push(null)` feed it. `readline`, `setEncoding`, `on("data")` and `on("end")` all behaved normally.
2. **A utility process never exits by itself.** A script that returns, with nothing pending, stays alive until `process.exit()` or a kill. `beforeExit` never fires.
   - The host therefore has to detect idleness. It polls `process.getActiveResourcesInfo()`, which does not list unref'd timers, plus `process._getActiveHandles()`, ignoring `process.stdout` and `process.stderr`.
   - In the prototype:

     | Case | Exit |
     |---|---|
     | Plain script | About 0.4 s after spawn |
     | A 600 ms timer that sets `process.exitCode = 5` | Code 5 after the timer |
     | A script that spawned a child process | Waited for it, then exited |
     | A readline server with stdin still open | Stayed alive until killed |
3. **Arguments.** Both a CommonJS script and an ESM script run correctly through `Module.runMain(script)` after `process.argv = [execPath, script, ...args]`:
   - `require.main === module` holds.
   - `process.argv.slice(2)` is the args.
   - `import.meta.url` is correct.
4. **stdout** never emits `end` for a utility process. All data, including 300 KB written just before `process.exit`, arrived before the main-side `exit` event. Flush on the next tick after `exit`.
5. **Exit code.** `exit` passes only an exit code, and `signal` is always `null`. Under the current Windows path the signal was `null` too, because of `taskkill /F`.

## Implementation plan

### 1. Node-script host — `assets/node-script-host.mjs` (new)

Its place and style match `assets/module-service-host.mjs`. It ships through `extraResources: assets`.

```js
// Host for a board's persephone.executeNode() script (US-1591). Runs in an Electron
// utilityProcess so the packaged app can lock the RunAsNode fuse. It gives the script the
// semantics of `node script.js`: argv, CommonJS/ESM entry, stdin fed by the main process over
// parentPort, and exit when the event loop has nothing left — none of which a utilityProcess
// provides on its own.
import Module from "node:module";
import { Readable } from "node:stream";

const SCRIPT_MARKER = "--persephone-node-script";
const IDLE_POLL_MS = 50;

const parentPort = process.parentPort;
const markerIndex = process.argv.indexOf(SCRIPT_MARKER);
const script = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
if (!parentPort || !script) {
    console.error("Persephone node-script host received invalid startup arguments.");
    process.exit(1);
}

// A utilityProcess has no stdin pipe: its process.stdin is a fixed, already-ended Readable
// that cannot be replaced. Re-initialize that same object as an open stream and feed it from
// the main process.
const stdin = process.stdin;
Readable.call(stdin, { read() {} });
parentPort.on("message", (event) => {
    const message = event?.data;
    if (message?.kind === "stdin") stdin.push(Buffer.from(message.data));
    else if (message?.kind === "end-stdin") stdin.push(null);
});

// A utilityProcess stays alive after its work is done. Exit like Node does: when no handle,
// request, or ref'd timer is left and stdin is not being read.
function stdinHoldsLoop() {
    return !stdin.readableEnded
        && (stdin.readableFlowing === true || stdin.listenerCount("readable") > 0);
}
function hasPendingWork() {
    if (stdinHoldsLoop()) return true;
    if (process.getActiveResourcesInfo().some((type) => type !== "PipeWrap" && type !== "TTYWrap")) return true;
    return process._getActiveHandles().some((handle) => handle !== process.stdout && handle !== process.stderr);
}
let idleTicks = 0;
setInterval(() => {
    if (hasPendingWork()) {
        idleTicks = 0;
        return;
    }
    if (++idleTicks < 2) return;
    process.emit("beforeExit", process.exitCode ?? 0);
    if (!hasPendingWork()) process.exit(process.exitCode ?? 0);
    idleTicks = 0;
}, IDLE_POLL_MS).unref();

process.argv = [process.execPath, script, ...process.argv.slice(markerIndex + 2)];
Module.runMain(script);
```

- Keep `Readable.call` and the idle loop exactly as above. Both were verified (Background 1–3).
- The `PipeWrap` exclusion in `getActiveResourcesInfo` covers the lazily created stdout and stderr pipes. A script's own pipes and sockets are still caught by the `_getActiveHandles` check.

### 2. Runner — `src/main/command-runner.ts`

Generalize the job's process so both kinds share stdin, kill, reaping and `getJobs`.

1. Replace `Job.proc: ChildProcessWithoutNullStreams` with:
   ```ts
   /** The process behind a job: a spawned child, or a board Node script in a utility process. */
   interface JobProcess {
       readonly pid: number | undefined;
       writeStdin(data: string | Uint8Array): void;
       endStdin(): void;
       kill(signal?: string): void;
   }
   ```
2. `treeKill(proc: JobProcess, signal?)`:
   - Same body, but use `proc.pid` and `proc.kill(...)`.
   - Remove the `ChildProcessWithoutNullStreams` parameter type. Keep the type import only if it is still used.
3. In `startJobTo`, wrap the spawned child:
   ```ts
   const jobProcess: JobProcess = {
       get pid() { return proc.pid; },
       writeStdin: (data) => { proc.stdin.write(data); },
       endStdin: () => { proc.stdin.end(); },
       kill: (signal) => { proc.kill((signal as NodeJS.Signals) || undefined); },
   };
   ```
   - Everything else in `startJobTo` is unchanged: stream listeners on `proc`, `close` → flush/exit/cleanup.
   - `writeJobStdin` and `endJobStdin` call `job.proc.writeStdin` and `job.proc.endStdin`, keeping their try/catch.
4. Add `startNodeJobTo`, exported next to `startJobTo`. Board scripts go through the same registry and coalescing code as other jobs.
   ```ts
   const NODE_SCRIPT_HOST = "node-script-host.mjs";

   /**
    * Run a board's Node script (`persephone.executeNode`) in an Electron utility process: the
    * packaged app locks the RunAsNode fuse, so the app binary can no longer be spawned as Node
    * (US-1591). Same sink protocol as startJobTo; signal is always null.
    */
   export function startNodeJobTo(sink: JobSink, msg: RunnerStartMsg): void {
       const { jobId, command: script, opts } = msg;
       let child: UtilityProcess;
       try {
           child = utilityProcess.fork(getAssetPath(NODE_SCRIPT_HOST), ["--persephone-node-script", script, ...(msg.args ?? [])], {
               cwd: opts?.cwd,
               env: { ...process.env, ...(opts?.env ?? {}), NODE_NO_WARNINGS: "1" },
               stdio: "pipe",
               serviceName: `Persephone board script: ${path.basename(script)}`,
           });
       } catch (err) {
           sink.send(RunnerChannel.error, { jobId, message: errMessage(err) });
           return;
       }
       // Messages posted before the host starts may be lost, so stdin waits for "spawn".
       let spawned = false;
       const pending: Array<{ kind: "stdin"; data: string | Uint8Array } | { kind: "end-stdin" }> = [];
       const post = (message: (typeof pending)[number]) => {
           if (spawned) child.postMessage(message);
           else pending.push(message);
       };
       child.once("spawn", () => {
           spawned = true;
           for (const message of pending.splice(0)) child.postMessage(message);
       });
       const jobProcess: JobProcess = {
           get pid() { return child.pid; },
           writeStdin: (data) => post({ kind: "stdin", data }),
           endStdin: () => post({ kind: "end-stdin" }),
           kill: () => { child.kill(); },
       };
       // job = { proc: jobProcess, sink, command: script, name: opts?.name, … } exactly like startJobTo;
       // activeJobs.set + indexJob; child.stdout?.on("data") / child.stderr?.on("data") push + scheduleFlush.
       child.on("exit", (code) => {
           // A utility process's stdout never emits "end"; its data arrives before "exit", so
           // flush on the next tick.
           setImmediate(() => {
               flush(jobId);
               sink.send(RunnerChannel.exit, { jobId, code, signal: null });
               cleanup(jobId);
           });
       });
   }
   ```
   - Imports: `utilityProcess` and the `UtilityProcess` type from `electron`, `path` from `node:path`, and `getAssetPath` from `./utils`.
   - The main process may import `path`. The `file-path` rule applies to the renderer.
   - `stdout`/`stderr` are typed nullable on `UtilityProcess`, hence `?.`, as in `module-service-supervisor.ts:399-400`.
   - `Job.command` for a node job is now the script path, not `process.execPath`. That is what a board's `getJobs()` should show.
5. Update the file header comment: board Node scripts run in a utility process through `startNodeJobTo`.

### 3. Bridge — `src/main/board-bridge.ts:360-372`

Before:
```ts
opts.shell = false;
opts.env = { ...opts.env, ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1" };
msg = { ...msg, command: process.execPath, args: [script, ...(msg.args ?? [])] };
}
startJobTo(portSink(entry, boardId), { ...msg, opts });
```
After:
```ts
startNodeJobTo(portSink(entry, boardId), { ...msg, command: script, opts });
return;
}
startJobTo(portSink(entry, boardId), { ...msg, opts });
```
- Keep the `fs.existsSync` check and its error message.
- `let msg` can become `const msg`.
- Import `startNodeJobTo`.

### 4. Wire comment — `src/ipc/runner-channels.ts:50-54`

The `node` marker doc should say it runs `command` as a Node script in an Electron utility process (`startNodeJobTo`) rather than on `ELECTRON_RUN_AS_NODE`.

### 5. Fuses — `electron-builder.yml`

Add the block after `asar: true`:

```yaml
# Electron fuses, flipped by electron-builder right before signing (EPIC-118 / US-1591).
# - runAsNode off: persephone.exe is not a Node runtime. Board Node scripts run in a
#   utilityProcess (assets/node-script-host.mjs) instead.
# - nodeOptions / nodeCliInspect off: NODE_OPTIONS, NODE_EXTRA_CA_CERTS and --inspect are
#   ignored by the release build.
# - asar integrity + onlyLoadAppFromAsar: app.asar is hash-checked at load and is the only
#   app source. electron-builder embeds the hash in the exe.
# - cookieEncryption on: browser cookies are encrypted at rest (DPAPI). One-way: existing
#   plaintext cookies stay readable and are encrypted on their next write.
# - grantFileProtocolExtraPrivileges stays at its default (on): the production window loads
#   index.html over file:// (open-window.ts loadFile).
electronFuses:
  runAsNode: false
  enableCookieEncryption: true
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
```

### 6. Developer docs

Update the two descriptions of the run-as-node path:

| File | Change |
|---|---|
| `doc/architecture/scripting.md:335` | `executeNode` runs in an Electron utility process through `assets/node-script-host.mjs`, with stdin fed over its parent port. Drop `ELECTRON_RUN_AS_NODE` |
| `doc/architecture/key-files.md:487` | Same change in the board-bridge row; add a row for `assets/node-script-host.mjs` |

The user guides need no change. `assets/guides/agents/boards.md` and `assets/board-template/CLAUDE.md` describe "Persephone's own bundled Node runtime", which stays true.

### 7. Checks

1. `npm run typecheck`, `npm run lint`, `npm run build-prod`.
2. **Dev (`npm start`), demo board.** Fuses don't apply in dev, but the new path does:
   - `executeNode → bundled runtime` probe returns `nodeVersion` and the sqlite rows, and the process exits.
   - The resident-server probe answers requests over stdin.
   - Kill works.
3. **Packaged: `npx electron-builder --win dir`, then `release/win-unpacked/`:**
   - `npx @electron/fuses read --app release/win-unpacked/persephone.exe` shows the six fuses set.
   - `ELECTRON_RUN_AS_NODE=1 persephone.exe -e "require('fs').writeFileSync('x','1')"` does not run as Node: no file is written.
   - The app starts. The demo board's `executeNode` probes and the SQLite viewer board work (open a `.sqlite` file and run a query).
   - Copy `win-unpacked`, change one byte inside `resources/app.asar` in the copy, then launch it. The app refuses to start.
   - A copied `resources/app/` folder next to a removed `app.asar` is not loaded.
4. **Cookie migration.**
   - In the installed 5.0.6 release, sign in to a site in a browser profile.
   - Run the packaged build against the same user data. The site is still signed in.

## Files changed

| File | Change |
|---|---|
| `assets/node-script-host.mjs` | New: utility-process host for `executeNode` scripts |
| `src/main/command-runner.ts` | `JobProcess` abstraction; `startNodeJobTo` |
| `src/main/board-bridge.ts` | `node: true` → `startNodeJobTo`; no `ELECTRON_RUN_AS_NODE` |
| `src/ipc/runner-channels.ts` | `node` marker comment |
| `electron-builder.yml` | `electronFuses` block |
| `doc/architecture/scripting.md`, `doc/architecture/key-files.md` | `executeNode` description |

**No change needed:**

- `src/board-shim.ts`: `executeNode` and the handle are unchanged.
- `src/shared/execute-handle.ts`, `src/renderer/api/proc.ts`, the renderer IPC runner path.
- `module-service-supervisor.ts` and `module-service-host.mjs`.
- `scripts/vmp-sign.mjs`: it runs `afterSign`, after the fuses are flipped.
- `BOARD_BRIDGE_VERSION`: the bridge API surface is unchanged.
- The user guides.

## Concerns / Open questions

1. **Private stream API.**
   - `Readable.call(process.stdin, …)` relies on Node's function-style stream constructor.
   - `process._getActiveHandles()` is undocumented.
   - Both work on Node 24.17 / Electron 43, and both are confined to one 60-line host.
   - Recheck the demo-board probes on every Electron upgrade. They fail loudly: a missing reply, or a process that never exits.
2. **Behavior differences a script can observe.** None of the current consumers rely on any of these:
   - `process.stdin` is not a real pipe (`isTTY` is undefined, as before, and there is no `fd`).
   - `process.parentPort` exists.
   - `process.type === "utility"`.
   - A finished script exits about 100 ms after going idle.
   - `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are ignored in release builds. A board script behind a TLS-intercepting proxy that needed `NODE_EXTRA_CA_CERTS` would now fail.
3. **Cookie encryption is one-way.** After 5.0.7, downgrading to 5.0.6 loses browser sign-ins (the downgrade can't read encrypted values). Mention this in `whats-new.md` at epic close.
4. **asar integrity covers `app.asar` only.** `resources/assets` holds the guides, the board template, the demo board, `module-service-host.mjs` and `node-script-host.mjs`, and it is outside the archive, so it is not hash-checked.
   - The default install is per-user (`perMachine: false`). Code running as the user can replace the whole install anyway.
   - So the integrity fuse closes the "edit the archive under a valid signature" case, not local tampering in general.
   - Moving the two hosts into the asar is a possible follow-up. It is not needed for this task.
5. **US-1585 (signing).** No conflict. electron-builder flips the fuses before Authenticode signing, and VMP signing runs `afterSign`. The fuse bytes and the asar hash live in the exe that gets signed.
6. **Dev builds** run on unmodified `electron.exe`, so the fuses only take effect in packaged builds. Checks in step 7.3 must use the `win-unpacked` build.

## Acceptance criteria

- `electron-builder.yml` sets the six fuses, and `@electron/fuses read` on the packaged exe confirms them.
- With `ELECTRON_RUN_AS_NODE=1`, the packaged exe does not run a script as Node.
- An edited `app.asar` stops the packaged app from starting.
- `persephone.executeNode()` keeps its contract in dev and packaged builds:
  - argv, stdout/stderr streaming, stdin write and `endStdin`, `kill`, exit code, and `name`-based `getJobs()`.
  - A finished script exits by itself.
  - The demo-board `executeNode` probes and the SQLite viewer board work.
- Browser profile sign-ins survive the upgrade from 5.0.6.
- No `ELECTRON_RUN_AS_NODE` left in `src/`.
- typecheck, lint and build-prod pass.

## Progress

- [x] `assets/node-script-host.mjs`
- [x] `command-runner.ts` `JobProcess` + `startNodeJobTo`
- [x] `board-bridge.ts` + `runner-channels.ts`
- [x] `electron-builder.yml` fuses
- [x] Developer docs
- [x] typecheck / lint / build-prod
- [x] Dev verification (2026-10-01, `npm start`):
  - Demo board `executeNode("scripts/node-probe.mjs", ["demo", "a b"])` returned args `["demo","a b"]`, Node 24.17.0 and the `node:sqlite` rows, then exited on its own with `{code: 0, signal: null}`.
  - The resident `node-server.mjs` answered two stdin requests. `getJobs()` listed it under its name with the script path as `command`. `endStdin()` exited it with code 0.
  - `kill()` on a second server gave `{code: 1, signal: null}`, and `getJobs()` was empty afterwards.
  - SQLite viewer board opened a test `.sqlite` file and showed its table rows.
- [x] Packaged verification (2026-10-01, `electron-builder --win dir`, `release/win-unpacked`):
  - `@electron/fuses read`: RunAsNode, NodeOptions and NodeCliInspect are Disabled. CookieEncryption, EmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar are Enabled. GrantFileProtocolExtraPrivileges stays Enabled.
  - The build log shows "updating asar integrity executable resource" before "executing @electron/fuses" and signing.
  - `ELECTRON_RUN_AS_NODE=1 persephone.exe -e "<write a file>"` wrote no file.
  - A copy with one byte of the `app.asar` header changed exited at once (code −36861). The untouched build, run with its own `--user-data-dir`, kept running.
  - The packaged build's own demo board (`boards.createDemoBoard`, driven over MCP on a separate port):
    - `executeNode` probe: `execPath` = packaged `persephone.exe`, args and sqlite rows correct, exit code 0.
    - Resident server answered over stdin and exited with code 0 on `endStdin`.
  - Cookie migration:
    - The unfused Electron wrote a plaintext cookie (`encrypted_value` empty) into a test partition.
    - The fused build read it back unchanged.
    - A cookie written by the fused build was stored encrypted: empty `value`, 81-byte `encrypted_value`.
    - The plaintext row stayed readable.
  - Not run: the SQLite viewer inside the packaged build (not installed in the test profile; it uses the same stdin path as the resident-server probe), and a real 5.0.6 → 5.0.7 upgrade with a real sign-in. The test-cookie run covers the same plaintext-to-encrypted read path.
