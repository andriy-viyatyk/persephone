# US-1439: Main-process clipboard capture service, store and IPC

Epic: [EPIC-104: Clipboard tracker](../../epics/EPIC-104.md)

## Goal

Connect the fixed `clipboard-watch` stdout protocol from US-1438 to a main-process capture and
history service. While the renderer-owned `clipboard.enabled` setting is on, the service reads
allowed text/HTML/image flavours through Electron, accepts file lists from the watcher event,
stores one deduplicated, capped item per clipboard change, and exposes the history, copy, delete,
clear, and listener-health operations needed by US-1441.

This task does not modify the watcher or settings implementation and does not build the Clipboard
panel. Its output is the main-process service, the minimal sidecar lifecycle extension, and the
typed IPC boundary that the panel will consume.

## Background

### Settled contracts this task consumes

- [EPIC-104](../../epics/EPIC-104.md) settles D3, D4, D5, D6, D7, D8, D11, and D12. In
  particular, the watcher is a notifier except for its parsed file list; Persephone's own copies
  are tracked; excluded changes are skipped completely; one item has a primary flavour plus
  optional siblings; payloads have `.txt`, `.html`, `.png`, or `.json` extensions; hashing
  promotes an equal item; the cap is an item count with immediate trimming; and health is proved
  by ping/pong evidence rather than process liveness alone.
- [US-1438](../US-1438-clipboard-watch-subcommand/README.md) is the wire contract. Readiness is
  exactly `clipboard-watch: ready`; change lines have `type: "clipboard-change"`, a dispatch-time
  `sequence`, `timestampMs`, ordered format metadata, `exclusion.ownerPid`,
  `exclusion.ownerTrusted`, fail-closed `exclusion.excluded`, and an optional `files` object;
  pings are `{"type":"ping"}` and pongs contain `sequence` and `lastEmittedSequence`; stdin EOF
  is the watcher's graceful shutdown path. The watcher accepts `--trusted-pid <pid>`; the
  configured owner may bypass Chromium's `CanIncludeInClipboardHistory = 0`, but never the
  explicit `ExcludeClipboardContentFromMonitorProcessing` marker.
- [US-1440](../US-1440-clipboard-settings/README.md) defines `clipboard.enabled`, the integer
  `clipboard.max-items` range of 1 through 1000 with fallback 100, and the renderer helper
  `normalizeClipboardMaxItems`. The current renderer source already contains those settings and
  helper. Main must receive the normalized cap as an argument over IPC and must not import the
  renderer settings module or read `appSettings.json`.

### Existing lifecycle and IPC patterns

`src/main/mneme-service.ts` is the lifecycle model: it owns one `SidecarProcess`, uses
`getSnipToolPath()`-style path resolution for its executable, starts with `{ windowsHide: true }`,
maps `SidecarStartResult` to a status, broadcasts changes through `openWindows.send`, and exposes
start/stop/restart functions to `src/ipc/main/core-handlers.ts`. The clipboard service should keep
the same domain-specific/service-vs-lifecycle split. The watcher command is
`persephone-snip.exe clipboard-watch`, resolved by `src/main/snip-service.ts`'s existing
`getSnipToolPath()`; no new executable or packaging entry is needed.

`src/main/sidecar-process.ts` currently keeps the child in private `proc`, exposes only
`pending`, starts with `SpawnOptionsWithoutStdio`, parses each trimmed stdout line in
`spawnAndAwaitReady()`, and invokes `onUnexpectedExit` when the current ready child closes. Its
existing `stop()` nulls `proc` synchronously before the close event, which is the stale-child guard
that prevents an intentional stop from being reported as an unexpected death.

The typed IPC path is `src/ipc/api-types.ts` (`Endpoint`, `Api`, `EventEndpoint`, `EventApi`) →
`src/ipc/renderer/api.ts` (`executeOnce`) and `src/ipc/renderer/renderer-events.ts` →
`src/ipc/main/core-handlers.ts` (`Controller` plus `initCoreHandlers`). Main-to-all-window
broadcasts use `openWindows.send`. `src/ipc/clipboard-ipc.ts` is already a main-free shared home
for `ClipboardFileList` and `ClipboardDropEffect`, so the new history/status types belong there.

`src/main/clip-service.ts` already implements `writeClipboardFiles(paths, cut)` through the
existing `clipboard-write` helper. It is the required path for copying a file-list item back as
Windows `CF_HDROP`; do not serialize file paths into text. `src/main/utils.ts` confirms the data
root as `<userData>/data`, while `src/main/mneme-service.ts` and
`src/main/published-boards-service.ts` establish feature-specific data below that root.

The renderer's `App.initEvents()` in `src/renderer/api/app.ts` waits for settings, starts enabled
services after the existing deferred startup delay, and subscribes to live `settings.onChanged`
events. Clipboard synchronization belongs in that process-lifetime wiring: both the enabled key
and cap key must send the current enabled value plus
`normalizeClipboardMaxItems(settings.get("clipboard.max-items"))` to main. The same call is made
at startup when the setting is already enabled, so startup reconciliation and capture do not depend
on US-1441 being open.

## Implementation Plan

### 1. Extend `SidecarProcess` for watcher input and intentional EOF

Update `src/main/sidecar-process.ts` without changing the existing Mneme/Tor behavior.

- Add a small public `writeLine(line: string): boolean` method. It must use the private current
  child's `stdin`, append one LF, and return `false` when there is no current child, stdin has
  ended/destroyed, or the write throws. A `Writable.write()` that accepts the data is a
  successful delivery even if it returns `false` for backpressure; ping lines are tiny and must
  not be dropped merely because the stream is temporarily buffered.
- Add a graceful intentional-stop path for the watcher, such as
  `stopAndWaitGracefully()`. It must capture the current child, synchronously detach/null
  `this.proc` and clear `runningFlag` before calling `proc.stdin.end()`, then wait using the same
  exit/timeout discipline as `stopAndWait()`. If ending stdin fails, kill the detached child so
  shutdown cannot hang. The synchronous detach is mandatory: the watcher's clean exit code 0 must
  fail `wasCurrent` and therefore must not invoke `onUnexpectedExit`.
- Keep `stop()` and `stopAndWait()` as the existing kill-based behavior for current callers. The
  new clipboard service uses the graceful method for a normal disable/restart and uses the
  existing kill path only as a bounded fallback or application shutdown path.
- Preserve the current `SpawnOptionsWithoutStdio` signature. Node's default piped stdio already
  gives this class the stdin/stdout/stderr streams that the current `ChildProcessWithoutNullStreams`
  type models.

Current and required shape:

```ts
// Before: src/main/sidecar-process.ts
private proc: ChildProcessWithoutNullStreams | null = null;

stop(): boolean {
    if (this.proc) {
        this.proc.kill();
        this.proc = null;
    }
    const wasRunning = this.runningFlag;
    this.runningFlag = false;
    return wasRunning;
}

// After: retain the stale-child guard before closing stdin, and expose only a line writer
writeLine(line: string): boolean { /* write `${line}\\n` to the current stdin */ }
stopAndWaitGracefully(): Promise<boolean> {
    /* detach current proc synchronously, end stdin, wait/reap with the existing timeout */
}
```

### 2. Add the main capture/store service

Create `src/main/clipboard-service.ts`. Keep all watcher parsing, Electron clipboard reads,
history persistence, hashing, eviction, pinging, and status state in this module; the IPC handler
should remain a thin adapter.

#### Sidecar lifecycle

Create one module-level `SidecarProcess` configured as follows:

- `name: "Clipboard"`.
- `isReady: (line) => line === "clipboard-watch: ready"` (exact trimmed sentinel).
- A readiness timeout consistent with the other local sidecars; return the failure through the
  status rather than throwing.
- `log` parses only JSON objects with `type` `clipboard-change` or `pong`; all other lines remain
  diagnostics and are not treated as payload. Use `errMessage` for any caught parse/read error.
- `onReady` updates/broadcasts the status. `onUnexpectedExit` marks the enabled service as an
  error with the exit code and broadcasts it; do not auto-restart, because the panel must show a
  visible failure and provide the Restart action.
- Start with `getSnipToolPath()`, `['clipboard-watch', '--trusted-pid', String(process.pid)]`, and
  `{ windowsHide: true }`. Chromium performs renderer clipboard writes through the Electron main
  process, so this is the owner pid used for the narrow marker exemption.

Expose service functions for the IPC layer:

```ts
setClipboardEnabled(enabled: boolean, maxItems: number): Promise<ClipboardStatus>;
getClipboardStatus(): ClipboardStatus;
getClipboardHistory(): Promise<ClipboardHistorySnapshot>;
removeClipboardItem(id: string): Promise<void>;
clearClipboardHistory(): Promise<void>;
copyClipboardItem(id: string): Promise<boolean>;
setClipboardHealthMonitoring(ownerId: number, active: boolean): ClipboardStatus;
restartClipboard(maxItems: number): Promise<ClipboardStatus>;
shutdownClipboard(): void;
```

`setClipboardEnabled(false, maxItems)` must update the cap and trim before/while stopping, then
leave the stored history intact. `setClipboardEnabled(true, maxItems)` must load/reconcile the
index, trim to the normalized cap, and start the sidecar. Repeated calls from multiple renderer
windows must join the same pending start rather than spawning another watcher. Restart must use
the graceful stop ordering from step 1, wait for the old process, then start the same executable
and command again.

#### Protocol validation and capture queue

Define internal type guards for the US-1438 change/pong objects. Do not cast arbitrary JSON from
stdout directly to a trusted event. Ignore malformed or unknown lines; a malformed change cannot
become a plaintext capture. Serialize change handling through one promise/mutation queue so
successive watcher lines cannot concurrently read the clipboard, rewrite the index, or reorder
promotions.

For each validated change line:

1. If `event.exclusion.excluded` is true, return before calling any Electron clipboard API and
   before touching the index or payload folder. This is the complete D6 behavior, including when
   `event.files` is present.
2. Treat `event.files` as the authoritative file-list payload. Validate its path strings and
   `dropEffect`; do not issue a follow-up `readClipboardFiles()` call, which could observe a later
   clipboard state.
3. Use the following explicit mapping from the watcher's raw Windows format IDs/names to decide
   which Electron APIs to call. The watcher emits the canonical predefined names from
   `snip-tool/src/clipboard_watch.rs` and registered names from `GetClipboardFormatNameW`; registered
   names must be matched case-insensitively.

   | Flavour | Formats that imply it | Capture path |
   |---|---|---|
   | `text` | `CF_UNICODETEXT` (13), `CF_TEXT` (1), or `CF_OEMTEXT` (7) | `clipboard.readText()` |
   | `html` | Registered name `HTML Format` (no fixed numeric ID) | `clipboard.readHTML()` |
   | `image` | `CF_DIB` (8), `CF_DIBV5` (17), `CF_BITMAP` (2), or registered name `PNG` | `clipboard.readImage()` then `toPNG()` |
   | `files` | `CF_HDROP` (15) | Never read through Electron; use `event.files` |

   Formats such as `DataObject`, `Ole Private Data`, `CF_LOCALE`, and every other unrecognized
   predefined or registered format are bookkeeping/unsupported data for this service: ignore them
   rather than treating them as an unknown flavour or reading their handles. Keep the watcher
   sequence and event timestamp as metadata; the watcher remains the only file-list reader.

4. Capture the available flavours once into UTF-8 text/HTML buffers, a PNG buffer from
   `readImage().toPNG()`, and the canonical JSON file-list buffer. Choose the primary flavour in
   this order: `files`, HTML, image, text. This keeps rich HTML as HTML when a plain-text sibling
   is also present, while a normal screenshot with no HTML remains an image. Store every other
   successfully read flavour as an optional sibling in the same item.
5. Use the primary flavour's payload bytes for a SHA-256 hash. The primary hash is deliberate: a
   repeated clipboard update or panel copy with the same primary content promotes one item even if
   optional sibling availability differs. Do not add a time-based self-echo suppression window.
6. Derive a bounded preview for the item index: prefer the plain-text flavour, otherwise use a
   compact HTML-text fallback, `N file(s)` for file lists, or an image label. Do not put payload
   bodies in the index or in status broadcasts.
7. Write staged payload files, update the in-memory newest-first list, remove any older entries
   with the same primary hash, insert the new item at index 0, evict oldest entries over the cap,
   and persist the repaired index before broadcasting `eClipboardHistoryChanged`. If a write
   fails, retain the prior indexed item set and report the capture failure without broadcasting a
   false success.

The canonical payload names are `<id>.txt`, `<id>.html`, `<id>.png`, and `<id>.json` under the
clipboard feature directory. The item index maps each flavour to its absolute payload path so the
panel can call the normal `app.pages.openFile(path)` route for the primary file. Generate IDs with
`crypto.randomUUID()` and treat the lowercase UUIDv4 shape
`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` as the only generated ID
shape. IDs must never be derived from clipboard content.

#### Store and reconciliation

Use a JSON index at `<userData>/data/clipboard/index.json`, beside the payload files, rather than
`electron-store`. The index and payloads are one feature-owned dataset, the payload paths must be
reconciled against the real filesystem, and the history can contain up to 1000 entries with
preview/path metadata that does not belong in the general application preferences store.

Use a versioned index shape with internal-only `hash` values and persisted item metadata:

```ts
interface ClipboardIndexFile {
    version: 1;
    items: Array<{
        id: string;
        capturedAt: number;
        primary: ClipboardFlavor;
        preview: string;
        payloads: Partial<Record<ClipboardFlavor, string>>;
        hash: string;
    }>;
}
```

Write the index through a temporary file followed by rename, and use the asynchronous `fs`
operations in the main process for payload/index I/O. On startup or first access, reconcile a valid
index as follows:

- If an item is missing its primary payload, remove that item and any remaining sibling files from
  the index; if only an optional sibling is missing, remove that sibling reference and keep the
  item.
- Treat valid indexed entries as authoritative. Recognized payload files not referenced by the
  repaired index are orphans from a partial write and are not shown; remove them during a valid
  reconciliation so an interrupted write cannot escape the D11 item cap. The orphan sweep may
  delete only files whose names match the generated-ID payload pattern exactly —
  `<uuid>.txt`, `<uuid>.html`, `<uuid>.png`, or `<uuid>.json` using the UUID shape defined above —
  and must never delete any other file in the clipboard directory. `clearClipboardHistory` removes
  all recognized feature payloads even when they are orphaned.
- If `index.json` is absent, malformed, or unreadable, start with an empty in-memory history,
  report/log the repair, and do not run an orphan sweep; leave all files untouched. A later
  successful write creates a fresh versioned index, and Clear remains the explicit way to remove all
  feature files.

Eviction, duplicate hashing, reconciliation, remove-one, clear-all, and cap changes all run in the
main service because it owns the only writes and the authoritative index. This also prevents two
renderer windows from applying different ordering or cap decisions. Lowering `maxItems` calls the
same trim routine immediately, even while the watcher is disabled.

### 3. Implement D12 health monitoring

The main service must keep health monitoring separate from sidecar lifetime. Track the IDs of
renderer owners that have requested monitoring; the panel calls the start operation on mount and
the stop operation on dispose. A destroyed renderer owner is removed as well. The ping interval
runs only while this owner set is non-empty, so a closed Clipboard panel does not keep polling.

Use named constants such as `PING_INTERVAL_MS = 1_000` and
`DEAF_AHEAD_PONG_THRESHOLD = 3`, then call `SidecarProcess.writeLine('{"type":"ping"}')` at that
interval. Track the last ping deadline and parse each pong. Use unsigned 32-bit wrap-safe
arithmetic, but require the ahead condition to persist across three consecutive pongs before
marking the listener `deaf`: when `lastEmittedSequence` is not null and the fresh OS `sequence` is
ahead of it by a forward distance less than `0x80000000`, increment the pending-deaf count; a single
ahead observation is evidence to start counting, never a verdict. Three one-second observations put
the minimum detection latency comfortably beyond the watcher's 500 ms maximum clipboard inspection
retry budget (`open_clipboard_retry()` retries ten times at 50 ms), avoiding a false badge while a
healthy listener is still flushing a contended change. Any change event that advances
`lastEmittedSequence` to or past the observed OS sequence clears the pending-deaf count immediately.
Equality or a wrap-safe non-ahead value also clears it. A missing pong after a bounded number of
intervals is an error. When no event has been emitted yet (`lastEmittedSequence: null`), a valid pong
proves the process is responsive but cannot establish an event baseline; keep the monitored sidecar
in its running/healthy state until a baseline exists.

Use a shared status shape that the renderer can badge without knowing sidecar internals:

```ts
type ClipboardHealth = "disabled" | "starting" | "running" | "healthy" | "deaf" | "error";

interface ClipboardStatus {
    enabled: boolean;
    running: boolean;
    health: ClipboardHealth;
    monitoring: boolean;
    error?: string;
}
```

Broadcast `eClipboardStatusChanged` on readiness, intentional stop, unexpected exit, ping/pong
health changes, deaf detection, restart, and start failure. Restart clears the error/deaf state,
gracefully closes the old watcher, waits for it, and starts a fresh watcher. No automatic restart
is performed.

### 4. Add shared types and typed IPC

Extend `src/ipc/clipboard-ipc.ts` with main-free shared types:

```ts
export type ClipboardFlavor = "text" | "html" | "image" | "files";

export interface ClipboardHistoryItem {
    id: string;
    capturedAt: number;
    primary: ClipboardFlavor;
    preview: string;
    payloads: Partial<Record<ClipboardFlavor, string>>;
}

export interface ClipboardHistorySnapshot {
    revision: number;
    items: ClipboardHistoryItem[];
}

export interface ClipboardHistoryChanged {
    revision: number;
    reason: "captured" | "removed" | "cleared" | "reconciled";
}

export type ClipboardHealth = "disabled" | "starting" | "running" | "healthy" | "deaf" | "error";

export interface ClipboardStatus {
    enabled: boolean;
    running: boolean;
    health: ClipboardHealth;
    monitoring: boolean;
    error?: string;
}
```

The `hash` and index schema remain main-private; the renderer only receives safe item metadata and
paths. Add the following typed endpoints to `src/ipc/api-types.ts` and implement their thin
forwarders in `src/ipc/renderer/api.ts` and `src/ipc/main/core-handlers.ts`:

- `setClipboardEnabled(enabled: boolean, maxItems: number): Promise<ClipboardStatus>` — starts or
  intentionally stops the watcher and applies the already-normalized cap. Calling it while
  disabled still trims a lowered cap.
- `getClipboardHistory(): Promise<ClipboardHistorySnapshot>` — returns the full current snapshot
  for initial panel load and recovery after a missed signal.
- `removeClipboardItem(id: string): Promise<void>` and `clearClipboardHistory(): Promise<void>` —
  delete the corresponding payloads/index entries and then emit the change signal.
- `copyClipboardItem(id: string): Promise<boolean>` — performs the flavour-aware main-process copy
  described in step 5 below.
- `getClipboardStatus(): Promise<ClipboardStatus>` — returns the current badge state.
- `setClipboardHealthMonitoring(active: boolean): Promise<ClipboardStatus>` — registers/unregisters
  the calling renderer as a ping owner; the main handler supplies `event.sender.id` privately.
- `restartClipboard(maxItems: number): Promise<ClipboardStatus>` — uses the normalized cap supplied
  by the renderer and restarts the watcher intentionally.

Add `eClipboardHistoryChanged` and `eClipboardStatusChanged` to `EventEndpoint`, their payloads to
`EventApi`, and corresponding `RendererEventObject` instances in
`src/ipc/renderer/renderer-events.ts`. The history transport is deliberately a query plus change
signal, not a full-list broadcast on every change: a panel queries once on mount and re-queries on
each revision signal; a full list of up to 1000 items with preview/path metadata is not copied into
every unsolicited event. The revision lets the renderer ignore an older query result and guarantees
that opening a panel after missed events still gets the authoritative current list.

### 5. Implement copy-back semantics

In `copyClipboardItem`, load the indexed item and validate every referenced payload before writing
to the OS clipboard:

- `text` primary: use Electron `clipboard.writeText()`.
- `html` primary: use `clipboard.write({ html, text })` when a text sibling exists, or the HTML-only
  equivalent when it does not. Include any non-file image sibling only if Electron's single write
  can preserve the advertised flavours without changing the primary semantics.
- `image` primary: create a `nativeImage` from the stored PNG and use Electron's image write API;
  include stored text/HTML siblings in the same multi-flavour write when available.
- `files` primary: parse the stored JSON `{ paths, dropEffect }`, validate it, and call the existing
  `writeClipboardFiles(paths, dropEffect === "cut")` from `src/main/clip-service.ts`. Never put
  file paths into a text clipboard as a substitute for `CF_HDROP`.

Return `false` for a missing/deleted payload, malformed JSON, an invalid file list, or a failed
helper/API write. Do not add a copy-origin suppression flag: the watcher will observe Persephone's
own copy, and D5's primary-content hash will promote it rather than create a second row.

### 6. Wire settings, shutdown, and lifecycle IPC

Update `src/renderer/api/app.ts` in both the deferred startup block and the process-lifetime
`settings.onChanged` subscriber. Add a small local synchronization path that always reads:

```ts
// Before: the startup/subscriber code only forwards the settings owned by existing sidecars.
if (this._settings.get("mneme.enabled")) {
    const mnemePort = this._settings.get("mneme.port") as number | undefined;
    api.setMnemeEnabled(true, mnemePort || undefined);
}

// After: import the existing normalizer from the renderer settings module and forward the
// clipboard state/cap on startup and whenever either clipboard key changes.
const { settings: settingsInstance, normalizeClipboardMaxItems } = await import("./settings");
const enabled = !!this._settings.get("clipboard.enabled");
const maxItems = normalizeClipboardMaxItems(
    this._settings.get("clipboard.max-items"),
);
void api.setClipboardEnabled(enabled, maxItems);
```

The startup path invokes it after `settings.wait()` for both enabled and disabled states so a cap
lowered while Persephone was closed is reconciled immediately; the sidecar itself starts only when
`enabled` is true. The live path invokes it when either `clipboard.enabled` or
`clipboard.max-items` changes. Destructure `normalizeClipboardMaxItems` alongside the existing
dynamic `settings` import rather than adding a main-process dependency. Do not normalize in main
and do not import `src/renderer/api/settings.ts` from main. Do not add a renderer-side suppression
window or a second setting reader.

Update `src/main/main-setup.ts` to import `shutdownClipboard` and call it from the existing
`app.on("will-quit")` cleanup block. This must be safe when the watcher never started and must not
produce an unexpected-exit status during application shutdown.

### 7. Verify without modifying parallel tasks

After implementation, verify the TypeScript/lint workflow and exercise the integration manually with
a release-built `persephone-snip.exe` from US-1438. Cover plain text, HTML plus text, images, file
lists with copy/cut effects, excluded changes, repeated/staged watcher messages, cap lowering while
on and off, hand-deleted payload reconciliation, remove/clear, watcher-missing/start failure, ping
deaf detection, restart, and application quit. Do not edit the US-1438 or US-1440 files, their
source implementation, `doc/active-work.md`, or the epic as part of this task.

## Concerns / Open questions (resolved)

- **History index location — resolved:** use `index.json` beside payloads under
  `<userData>/data/clipboard`. `electron-store` remains appropriate for preferences and small
  caches, but it cannot reconcile a payload directory or represent the feature's atomic
  index-plus-files lifecycle as clearly. The index is authoritative; missing primary files remove
  items, missing siblings are dropped, valid unreferenced payloads are cleaned up, and malformed
  indexes reset to an empty in-memory list without deleting unrecognized files.
- **Hashing/eviction owner — resolved:** the main process owns both. It is the process that reads
  Electron clipboard data, writes payloads, serializes the index, and receives all mutation IPC;
  keeping hashing, promotion, trimming, and deletion in one queued owner avoids renderer races and
  keeps the renderer free of secret payload bodies.
- **List delivery — resolved:** query plus revision signal. The panel queries the snapshot on mount
  and after `eClipboardHistoryChanged`; the event carries only revision/reason. This bounds event
  size even at 1000 entries while still recovering from a panel that was closed during changes.
- **Image cost — resolved:** call `clipboard.readImage()` only for an event advertising an image,
  call it once, and store the resulting `nativeImage.toPNG()` bytes as `.png`. There is no second
  byte ceiling or arbitrary large-image rejection because D11 deliberately limits item count only;
  an empty/read/encode failure skips that flavour and may fall back to another advertised flavour.
  The decoded bitmap is not retained after the capture, and all avoidable filesystem work remains
  asynchronous.
- **Copy-back flavours — resolved:** copy the primary flavour, preserve compatible text/HTML/image
  siblings in one Electron multi-flavour write where possible, and use `writeClipboardFiles` for a
  file-list primary so Windows receives `CF_HDROP`. A file-list item is never copied as text.
- **Startup and disabled reconciliation — resolved recommendation:** when startup settings are on,
  load/reconcile the existing index, apply the current cap, and then start the watcher. When the
  setting is turned off, stop watching and writing but keep existing history on disk; only Remove
  or Clear deletes it. Keeping history makes a temporary opt-out reversible and matches the
  explicit destructive controls in D10. This is a user-facing retention behavior that should be
  called out for product review, but it is the implementation recommendation for this task.
- **Intentional shutdown — resolved:** normal service disable/restart detaches the sidecar from
  `SidecarProcess` before ending stdin, so the watcher's clean EOF exit cannot satisfy
  `wasCurrent && ready`. Application quit uses the same intentional guard or the existing kill
  path and never surfaces a false unexpected-stop error.
- **No self-echo suppression — resolved by D4:** no timer, origin marker, or ignore-next-change
  state is allowed. The panel's Copy action is captured normally and D5 handles the duplicate by
  promotion.
- **Multi-window health — resolved:** health ping ownership is reference-counted by renderer
  `webContents.id`. The interval starts with the first open panel, stops after the last panel closes,
  and destroyed renderers are removed so a dead window cannot keep pings alive.

## Acceptance Criteria

- [ ] `src/main/sidecar-process.ts` can write one newline-delimited ping to the live child and can
      intentionally close stdin without reporting the watcher's clean exit as unexpected; existing
      sidecars retain their current behavior.
- [ ] `src/main/clipboard-service.ts` starts `persephone-snip.exe clipboard-watch` through
      `SidecarProcess`, waits for the exact readiness sentinel, stops/restarts at runtime, and
      degrades to a visible status error if the helper is absent or fails to become ready.
- [ ] Renderer startup and live setting changes pass `clipboard.enabled` plus a normalized
      1–1000 `clipboard.max-items` value to main; main reads neither renderer settings nor the
      settings file.
- [ ] Every non-excluded valid change captures at most one history item with a primary truthful
      extension and optional sibling payloads. Excluded changes cause no Electron payload read, no
      file write, and no history entry.
- [ ] Text/HTML/image payloads are read from Electron's main-process `clipboard` API; file lists
      come only from the watcher's event and are stored as validated UTF-8 JSON.
- [ ] History is stored below `<userData>/data/clipboard`, survives restarts when disabled, repairs
      missing/deleted payload references, removes valid orphans during reconciliation, and keeps
      the index/payload set bounded to the configured item count.
- [ ] SHA-256 equality of primary payload bytes removes the old item and inserts the new capture at
      the top. The same content never appears as two history entries, and no self-echo suppression
      exists.
- [ ] Lowering the cap trims oldest entries immediately, including while disabled; enabling,
      restart, capture, remove, and clear all preserve newest-first ordering and persist the index
      before broadcasting changes.
- [ ] IPC exposes a full snapshot query, revision change signal, remove-one, clear-all, primary-aware
      copy-back, status query, panel-scoped health monitoring, and restart. The panel can open a
      primary payload through its real path and does not receive payload bodies in list broadcasts.
- [ ] File-list copy-back calls `writeClipboardFiles` with the stored cut/copy effect; text, HTML,
      and image items use Electron clipboard writes. Copying from Persephone is tracked like any
      other copy and is collapsed/promoted by the hash rule.
- [ ] While health monitoring is active, pings produce pong-based healthy/deaf status using
      wrap-safe sequence comparison; monitoring stops when no Clipboard panel owner remains. An
      explicit restart clears a recoverable health failure and starts a fresh listener.
- [ ] `src/main/main-setup.ts` shuts the watcher down intentionally during `will-quit`, with no
      false unexpected-exit notification.
- [ ] No US-1438/US-1440 implementation or task document, epic, or `doc/active-work.md` is
      modified by this task.

## Files Changed

| File | Planned change |
|---|---|
| `src/main/sidecar-process.ts` | Add the minimal stdin line writer and an intentional graceful-stop ordering/path for the watcher. |
| `src/main/clipboard-service.ts` | New main-process watcher lifecycle, protocol parser, Electron capture, JSON index/payload store, hashing, eviction, copy-back, health pinging, and status broadcasts. |
| `src/main/main-setup.ts` | Shut down the clipboard service from the existing `will-quit` cleanup. |
| `src/ipc/clipboard-ipc.ts` | Add shared flavour, history snapshot/change, and status types with no main-only imports. |
| `src/ipc/api-types.ts` | Add clipboard lifecycle/history/copy/health endpoints and history/status event contracts. |
| `src/ipc/renderer/api.ts` | Add typed renderer calls for the new endpoints. |
| `src/ipc/renderer/renderer-events.ts` | Register renderer listeners for history and status broadcasts. |
| `src/ipc/main/core-handlers.ts` | Bind the new endpoints to `clipboard-service`; supply renderer owner IDs for health monitoring. |
| `src/renderer/api/app.ts` | Start/sync/stop the main service from normalized renderer-owned clipboard settings. |
| `doc/tasks/US-1439-clipboard-capture-service/README.md` | This investigation and implementation contract. |

Files that need **no changes** for US-1439: `snip-tool/src/main.rs`,
`snip-tool/src/clipboard.rs`, `snip-tool/src/clipboard_watch.rs`,
`doc/tasks/US-1438-clipboard-watch-subcommand/README.md`,
`doc/tasks/US-1440-clipboard-settings/README.md`, `doc/epics/EPIC-104.md`,
`doc/active-work.md`, `src/main/mneme-service.ts`, `src/main/clip-service.ts`,
`src/main/snip-service.ts`, `src/main/e-store.ts`, `src/main/published-boards-service.ts`,
`electron-builder.yml`, and the US-1441 panel files (which do not yet exist in this checkout).
