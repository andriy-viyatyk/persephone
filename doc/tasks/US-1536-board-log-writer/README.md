# US-1536: Board `ui.log` has one main-owned writer

Belongs to [EPIC-115](../../epics/EPIC-115.md#us-1536-board-ui-log--one-main-owned-writer-no-truncation-bundled-boards-log-to-userdata), Phase 1. This task document records source-verified findings and a concrete implementation plan; this story is investigation only until approved for implementation.

## Goal

Make the Electron main process the only process that writes a board's `ui.log`, preserving service output across board opens and reloads while keeping the log bounded. Route bundled-board logs into per-board storage under Electron `userData`, and make the toolbar open the same main-resolved log path.

## Background

### Verified current writers and readers

- `src/renderer/editors/board/BoardWebview.ts:228-237` registers the board, then the main frame writes `board loaded` with `fs.write()` to `<boardRoot>/ui.log`. `write()` truncates the file on each mount/reload. The writer is guarded by `isMain`, so secondary frames do not reset the log.
- `src/renderer/editors/board/BoardWebview.ts:1246-1252` also writes directly through `fs.append()` for renderer-side messages and formats lines as ISO timestamp, level, message. The message routes include the board's `board:error`, `board:log`, invalid toolbar payloads, and invalid AiVision registrations.
- `src/renderer/editors/board/BoardEditorModel.ts:1082-1086` computes the toolbar log path as `<currentBoardRoot>/ui.log`; `src/renderer/editors/board/BoardToolbar.ts:210-212` opens it through `openRawLink`.
- `src/main/board-bridge.ts:349-359` mirrors `notify` errors/warnings with synchronous `appendFileSync()` to `entry.root/ui.log`, formatted with timestamp and notification type. `:453-470` has a second `appendFileSync()` path for load failures.
- `src/main/board-protocol-service.ts:274-288` has `logBoardDocMissing()`, another synchronous `appendFileSync()` to `root/ui.log`; the HTML document-serving branches call it for missing documents / error responses at `:445-449`.
- `src/main/module-service-supervisor.ts:125-180` defines `BoundedServiceLog`; stdout/stderr lines are prefixed with the board root and stream. Each `startOneAttempt` creates a new instance at `:594-596`. It maintains a 256 KiB tail by read-concatenate-rewrite for every drained chunk (`:162-171`), independent of the other writers.
- `src/ipc/module-service-channels.ts:14-15` currently defines `MAX_SERVICE_LOG_BYTES = 256 * 1024` and `MAX_SERVICE_LOG_CHUNK_BYTES = 8 * 1024`. A repo-wide import search confirms only `src/main/module-service-supervisor.ts` imports them. Move both constants and their semantics into `src/main/board-log.ts`, renaming them to board-log concepts, and remove them from `module-service-channels.ts`.

### Bundled identity and current storage paths

- `src/renderer/editors/board/bundled-board-registry.ts:40-59` gets the app root from `api.getAppRootPath()`, scans its `assets/boards` child, reads each manifest, and records the exact board root plus a stable folder-name `id` and `origin: "bundled"`. Its `isBundled(root)` compares normalized roots (`:71-75`).
- `src/main/utils.ts:17-36` resolves the app root to `process.resourcesPath` when packaged, or the repository root in development; `getAssetPath("boards")` resolves the matching assets directory. `getDataFolder()` is `<userData>/data` (`:42-48`).
- Main's `registerBoard()` currently receives a root but does not receive bundled provenance; its `hostToRoot` map in `src/main/board-protocol-service.ts` tracks live board:// registrations. The renderer already syncs trusted-board snapshots to main (`src/renderer/api/board-trust-sync.ts` and `src/ipc/main/board-handlers.ts`), but that snapshot is not the bundled registry. Recognize a bundled board only when its normalized absolute root is a direct child of `getAssetPath("boards")`; boards are one level deep and never nest. Compare case-insensitively on `win32` after `path.resolve()`, reject the boards directory itself and anything outside its direct children, and use that child folder name as the id.
- The renderer bundled-board registry's `api.getAppRootPath()/assets/boards` is the same location as main's `getAssetPath("boards")` in development and packaged builds (`src/main/utils.ts:17-35`). `package.json:3` and `electron-builder.yml:2` both set `productName` to `persephone`, and no `app.setName()` override exists. On Windows the exact agent-facing log path is therefore `%APPDATA%\persephone\board-logs\<id>\ui.log` (equivalent to `<app.getPath("userData")>/board-logs/<id>/ui.log`).

### IPC and board-visible contract

- Board request/reply APIs use `Endpoint` in `src/ipc/api-types.ts`, renderer `executeOnce()` methods in `src/ipc/renderer/api.ts`, and main `bindEndpoint()` handlers in `src/ipc/main/board-handlers.ts`. `Endpoint.registerBoard` is the existing board root registration seam (`api-types.ts:116,276`; handler at `board-handlers.ts:59-70`). Add log append/path operations at this typed IPC seam and route writes to `src/main/board-log.ts`.
- Export `type BoardLogLevel = "info" | "warn" | "warning" | "error" | "stdout" | "stderr"` from `src/ipc/api-types.ts`, which is already shared by main and renderer. Preserve existing caller levels (`"warning"` for notify, `"warn"` for `board:log`). Main formats every on-disk entry as `[ISO] [level] message\n`; split input messages on `/\r?\n/`, discard empty segments, cap each resulting line at 8 KiB before queueing, then format and append one physical line per segment.
- `src/ipc/board-bridge-channels.ts:378-406` carries existing frame-to-host `board:log` messages for mirrored `console.warn`/`console.error`; the renderer receives these in `BoardWebview` and currently writes them. The log writer move changes where this existing message is persisted, not its payload or the `persephone` API.
- `src/shared/board-bridge-version.ts` defines the board-facing version. The current board bridge does not expose a `ui.log` path; `PERSEPHONE_BOARD_ROOT` is set only in the service subprocess environment (`src/main/module-service-supervisor.ts:741-756`) to identify the board root. No new board-visible log path or API is planned, so keep the bridge version unchanged. The service's existing root environment value remains unchanged; only Persephone's persisted log path changes for bundled boards.
- Agent discoverability does not need a new MCP/boards API or Board Info field. Update `assets/guides/agents/boards.md` with the exact bundled location `%APPDATA%\persephone\board-logs\<id>\ui.log`; the board root remains available to existing tools, and bundled boards are shipped app-owned boards that rarely need direct log-file debugging. Keep `PERSEPHONE_BOARD_ROOT` unchanged; it remains the service's board-root identity and does not disclose the redirected log path.
- A repo-wide `src/` search for `ui.log` confirms the code references above are the only file writers and path reader. `src/renderer/editors/board-info/`, the boards AiVision namespace (`src/renderer/scripting/ai-vision/namespaces/boards.ts`), board API declarations (`src/renderer/api/types/boards.d.ts`, `src/renderer/editors/board/board-api.d.ts`), and MCP main handlers do not expose a log path. `Board Info` and the boards API therefore need no changes. `src/renderer/api/pages/PagesLifecycleModel.ts` creates bundled pages but does not choose or store log paths; `custom-editor-registry.ts` consumes bundled origin only in renderer registration.
- EPIC-115 standing rules require live-invoking each changed message path twice against an already-open page. This applies to the new append and path-resolution IPC paths at implementation time; it is an integration check, not a unit-test proposal. The epic's bridge-version rule is addressed above. Its cross-repository service-protocol rule is specific to US-1543 and does not apply here.

### Documentation passages to update when implementing

- `assets/guides/boards.md:614,671,855,1277-1279` describes service output at `<boardRoot>/ui.log`, log contents/location, and says each open/reload resets the log to `board loaded`.
- `assets/guides/agents/boards.md:369,623,1143-1151` describes service stdout/stderr at `<boardRoot>/ui.log` and the log as located in the board folder.
- `assets/board-template/CLAUDE.md:499,1173-1180` tells board authors that service output and the log are in the board folder; it also describes the `board loaded` reset behavior.
- `doc/architecture/overview.md:440` says each load starts a fresh `ui.log` and defines the old current-lifetime behavior.
- `doc/architecture/editors.md:674,682` and `doc/architecture/folder-structure.md:658` mention main-frame-only log reset. `doc/architecture/key-files.md:449` mentions the reset in the BoardWebview responsibility summary.

These guide and architecture edits are implementation follow-up work; this investigation task does not edit them.

### Audited files that need no changes

`src/shared/board-bridge-version.ts`, `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`, service-host board-visible APIs, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/editors/board-info/`, `src/renderer/scripting/ai-vision/namespaces/boards.ts`, `src/renderer/api/types/boards.d.ts`, `src/renderer/editors/board/board-api.d.ts`, `src/main/mcp/`, and bundled board source under `assets/boards/`. These were audited for board-visible log paths or ownership; none needs a code change for this story.

## Implementation Plan

1. Add `src/main/board-log.ts` as the single log path authority and writer. Export `boardLogPath(root)` and `append(root, level, line)`. Normalize the resolved root and serialize operations through one queue per destination file so concurrent renderer and main callers cannot interleave with compaction or lose writes.
2. Resolve bundled roots only when the normalized absolute root is a direct child of `getAssetPath("boards")`, comparing case-insensitively after `path.resolve()` on `win32`. Use that direct-child folder name as id and reject a nested root or the boards directory itself. Map bundled boards to `<app.getPath("userData")>/board-logs/<id>/ui.log`; non-bundled boards stay at `<root>/ui.log`.
3. Move the current values `256 * 1024` and `8 * 1024` into `src/main/board-log.ts` as the file and per-line limits, and delete `MAX_SERVICE_LOG_BYTES` / `MAX_SERVICE_LOG_CHUNK_BYTES` from `src/ipc/module-service-channels.ts` after removing their only importer, `src/main/module-service-supervisor.ts`.
4. Keep one cached byte size per destination-file queue. On first use initialize it with `fs.promises.stat()` and treat `ENOENT` as size zero. Split every source message on `/\r?\n/`, drop empty lines, cap each resulting UTF-8 line at 8 KiB before queueing, and format it in main as `[ISO] [level] message\n`; the cached byte count includes the formatted line and trailing newline. For each queued line, if `cachedSize + formattedLineByteLength` exceeds 256 KiB, read the file, find the first newline at or after the offset `fileLength - 128 KiB`, retain the bytes after that newline (so the retained tail starts at a complete line; if no such newline exists, retain an empty tail), write that tail back, and re-stat to refresh cached size. Then append the formatted line with `fs.promises.appendFile()` and update the cache. An external edit such as a user truncating the log in an editor is tolerated: stale over-count can only cause an early trim, and the cache is refreshed after every trim.
5. Add typed IPC endpoints for appending a renderer-originated log entry and resolving its path. Declare endpoint signatures and the shared `BoardLogLevel` type in `src/ipc/api-types.ts`, renderer wrappers in `src/ipc/renderer/api.ts`, and handlers in `src/ipc/main/board-handlers.ts`. The append request carries board root, level, and message; main splits multiline input, drops empty lines, applies the 8 KiB line cap, formats each line as `[ISO] [level] message\n`, and queues it. Append IPC is fire-and-forget on renderer hot paths; callers use `void ... .catch(() => {})` and never await it. The main handler catches append failures, emits exactly one `console.warn` for that failure, and resolves normally so it never throws into the renderer.
6. In `src/renderer/editors/board/BoardWebview.ts`, replace the truncating `fs.write()` load marker with `void api.appendBoardLog(boardRoot, "info", "----- board loaded -----").catch(() => {})`. Keep this call fire-and-forget so disk latency cannot delay board registration. Since there is no longer an `await` between the existing `this.live` checks, remove the second check as redundant. Replace `appendLog()`'s direct `fs.append()` with fire-and-forget typed IPC and remove its renderer line formatter.
7. In `src/main/board-bridge.ts`, replace both direct synchronous append sites (`notify` warning/error and load-failure report) with fire-and-forget `boardLog.append()` calls whose rejections are swallowed so bridge handling remains non-fatal. In `src/main/board-protocol-service.ts`, replace `logBoardDocMissing()`'s direct file write with the same best-effort writer. Preserve the caller's current `warning`, `error`, and `warn` levels.
8. In `src/main/module-service-supervisor.ts`, remove `BoundedServiceLog`, its constants/imports and per-attempt instance. Split each stdout/stderr chunk into lines as today and enqueue each with level `stdout` or `stderr`; accept today's per-chunk splitting behavior, including a chunk ending mid-line, and do not add cross-chunk line buffering. Drop the `[service:<root> ...]` prefix because the file is already board-specific. This removes log buffering and tail rewriting from the supervisor; **US-1545 will no longer have `BoundedServiceLog` to move**, and the user will update that epic section separately.
9. Add a `getBoardLogPath(root)` IPC operation. Enqueue a path-resolution barrier behind that destination's queued writes; inside the barrier create the parent directory and an empty file if missing, then return the resolved path only after prior writes have drained. Make `BoardEditorModel.getSelectedBoardLogPath()` async and make `BoardToolbar.openLog()` await it before opening; this preserves the old guarantee that Open board log does not land on a missing file.
10. Audit the full repository for `ui.log` reads/writes and stale path/reset wording. Update only the guide and architecture passages listed above during implementation, including `assets/guides/agents/boards.md` with the Windows `%APPDATA%\persephone\board-logs\<id>\ui.log` path. Add no MCP/boards API or Board Info field. Keep `PERSEPHONE_BOARD_ROOT`, board bridge message shapes, and `BOARD_BRIDGE_VERSION` unchanged.
11. Do not delete `assets/boards/excalidraw/ui.log`: it currently exists as an ignored, untracked user file (`git check-ignore` confirms `*.log`). After this story's redirects, Persephone will write new bundled-board log entries under `userData`; the existing install-tree file remains untouched.

### Before → after

```ts
// Before: renderer reset and append each choose a raw board-folder path.
await fs.write(fpJoin(boardRoot, "ui.log"), loadLine);
void fs.append(fpJoin(boardRoot, "ui.log"), line);

// After: renderer requests append without waiting; main formats and serializes writes.
void api.appendBoardLog(boardRoot, "info", "----- board loaded -----").catch(() => {});
void api.appendBoardLog(boardRoot, level, message).catch(() => {});
```

```ts
// Before: supervisor owns its own read/trim/rewrite loop.
const next = Buffer.concat([previous, chunk]).subarray(-MAX_SERVICE_LOG_BYTES);
await fs.promises.writeFile(filePath, next);

// After: service output joins the same per-file serialized append/trim queue.
void boardLog.append(boardRoot, "stdout", line);
```

## Concerns

- **Bundled root recognition:** Main must recognize only direct children of `getAssetPath("boards")`, with win32 case folding and no nested-board matching. The renderer and main paths are the same in dev and packaged builds, and the id is exactly the direct child's name.
- **Size tracking:** Each per-file queue owns a cached byte size, initialized with `stat`/ENOENT handling; appends use `appendFile`. Exceeding 256 KiB triggers read, trim to the last 128 KiB beginning after a newline boundary, rewrite, re-stat, then append. This bound applies across all log sources, and each individual line is capped at 8 KiB before queueing. Stale over-count after external edits only causes an early trim; trim refreshes the cache.
- **Line format:** Main writes every entry as `[ISO] [level] message\n`, splitting CRLF/LF multiline messages and omitting empty lines. `BoardLogLevel` is the shared union in `src/ipc/api-types.ts`; existing `warn` and `warning` spellings remain distinct. Service output is `[ISO] [stdout|stderr] message\n`, without a root prefix.
- **Load marker semantics:** Append `----- board loaded -----` at `info` level on each main-frame registration, without awaiting disk I/O. The promise rejection is swallowed and the now-adjacent second `this.live` check is redundant and removed. Earlier history, including service output while no page was open, remains until size compaction.
- **Service chunking:** Keep today's per-chunk split semantics. A chunk ending mid-line is logged as that chunk's final fragment; do not buffer across chunks.
- **Failure behavior:** The IPC append handler catches failures, warns once, and resolves normally. Renderer hot-path callers never await and swallow rejection; main bridge/service call sites also remain non-fatal.
- **Open-log ordering:** `getBoardLogPath(root)` waits for the per-file queue to drain, creates the parent and empty file if needed, then returns the resolved location. `BoardEditorModel`'s getter becomes async and `BoardToolbar.openLog()` awaits it, retaining the old non-missing-file guarantee documented in `assets/guides/whats-new.md:905`.
- **Agent discoverability:** Do not add an MCP/boards API or Board Info field. Add the exact Windows userData path `%APPDATA%\persephone\board-logs\<id>\ui.log` to the agent guide; `package.json:3` and `electron-builder.yml:2` set the app's product name to `persephone`.
- **Existing ignored file:** `assets/boards/excalidraw/ui.log` is gitignored by `*.log` and currently exists as an ignored user file. Do not delete or edit it; after bundled path redirection, no new entries are written there.
- **US-1545:** This task removes `BoundedServiceLog`, so the later supervisor split has nothing to move. The user will update the epic's US-1545 section.
- **Bridge version:** Keep `src/shared/board-bridge-version.ts` unchanged. This changes Persephone's internal file destination and adds host-renderer IPC only; board iframe API, message payloads, and service environment do not change.
- **No tests are proposed by this task document**, per the task instruction.

## Acceptance Criteria

- [x] All board UI-log writes pass through `src/main/board-log.ts`; no other module writes `ui.log` directly.
- [x] Renderer load markers append a separator and never truncate existing logs.
- [x] Service output logged before a page opens remains when the board page opens.
- [x] All sources share one serialized per-file queue and one 256 KiB size bound; trimming cannot race with a concurrent append.
- [x] Each queue initializes cached bytes with `stat` (ENOENT → 0), uses `appendFile`, and on overflow retains the last 128 KiB starting at a newline boundary before re-statting and appending.
- [x] All messages split on CRLF/LF, omit empty lines, and cap each emitted line at 8 KiB; every stored line has main-owned `[ISO] [level] message` formatting.
- [x] A bundled board's log resolves to `<userData>/board-logs/<board-id>/ui.log`; non-bundled boards retain `<boardRoot>/ui.log`.
- [x] The Open board log toolbar action resolves the path through main and opens that exact file.
- [x] Path resolution drains queued writes and creates the parent and empty log file before returning.
- [x] Load separators are fire-and-forget at info level with swallowed rejection; no registration wait is introduced.
- [x] `BoundedServiceLog` and its per-restart instance are removed from `src/main/module-service-supervisor.ts`.
- [x] Existing log line source/severity information remains understandable and write failures remain non-fatal.
- [x] `PERSEPHONE_BOARD_ROOT` and the board-visible API remain unchanged; no `BOARD_BRIDGE_VERSION` bump.
- [x] Agent guidance gives the bundled log path `%APPDATA%\persephone\board-logs\<id>\ui.log`; no MCP/boards API or Board Info field is added.
- [x] Service output uses `stdout`/`stderr` levels without the board-root prefix and retains per-chunk splitting without cross-chunk buffering.
- [x] The existing ignored `assets/boards/excalidraw/ui.log` is left untouched and receives no new writes.
- [x] The US-1545 plan no longer needs to move `BoundedServiceLog`; EPIC-115 US-1545 section updated.
- [x] Live-invoke each changed IPC message path twice against an already-open page, as required by EPIC-115's standing rule.
- [x] Update the board user guide, agent guide, shipped board template author guide, and architecture passages that describe a board-folder log or per-load reset.
- [x] Repository audit finds no other `ui.log` writer/reader path that bypasses main or disagrees with the resolved location.

## Files Changed Summary

| File | Planned change |
|------|----------------|
| `src/main/board-log.ts` | Add main-owned path resolution, bounded serialized append queue, and line formatting. |
| `src/ipc/api-types.ts` | Declare typed board-log append and path-resolution endpoints. |
| `src/ipc/renderer/api.ts` | Add renderer request wrappers for board log append/path resolution. |
| `src/ipc/main/board-handlers.ts` | Bind the board log IPC endpoints to `src/main/board-log.ts`. |
| `src/renderer/editors/board/BoardWebview.ts` | Append load separators and renderer log messages over IPC. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Resolve the Open board log path through main. |
| `src/renderer/editors/board/BoardToolbar.ts` | Await the main-resolved log path before opening. |
| `src/main/board-bridge.ts` | Route notification and navigation failure lines through the shared writer. |
| `src/main/board-protocol-service.ts` | Route missing-document lines through the shared writer. |
| `src/main/module-service-supervisor.ts` | Delete `BoundedServiceLog`; route service output to shared append. |
| `src/ipc/module-service-channels.ts` | Remove `MAX_SERVICE_LOG_BYTES` and `MAX_SERVICE_LOG_CHUNK_BYTES` after the supervisor stops importing them. |
| `assets/guides/boards.md` | Correct bundled log location and remove reset-on-load wording. |
| `assets/guides/agents/boards.md` | Correct bundled log location and explain retained history. |
| `assets/board-template/CLAUDE.md` | Correct shipped board-author references to log location/reset behavior. |
| `doc/architecture/overview.md` | Document append-on-load behavior and bundled log storage. |
| `doc/architecture/editors.md` | Remove main-frame reset descriptions; describe main-owned append/path resolution. |
| `doc/architecture/folder-structure.md` | Update BoardWebview responsibility summary. |
| `doc/architecture/key-files.md` | Update BoardWebview responsibility summary. |

## Verification (2026-09-28)

- `npm run typecheck`, `npm run lint`, `node scripts/build-prod.mjs`: pass.
- Live, after a cold `npm start` (the running main process predated the change):
  - Service stdout/stderr written while no board page was open (service started by reading a `mem://` provider URL) kept after the board page opened; the page load appended `----- board loaded -----` instead of truncating. Two further reloads each appended a separator; nothing was lost.
  - Service lines now use `[ISO] [stdout|stderr] line`, without the board-root prefix.
  - `persephone.notify(..., "error")` (main bridge), mirrored `console.warn` (renderer IPC), and a missing board document (protocol service) each logged through the shared writer, twice.
  - `getBoardLogPath` for a bundled root (`assets/boards/excalidraw`, also upper-cased) returns `%APPDATA%\persephone\board-logs\excalidraw\ui.log`; a non-bundled root returns `<root>\ui.log`. Bundled appends landed in userData; nothing new was written under `assets/boards/excalidraw/`.
  - 400 concurrent 1 KB appends plus one 20 KB line: file trimmed to ~161 KB at a line boundary, no gaps in the surviving sequence, the oversized line capped at 8 KiB.

### Not verified

- `reportBoardLoadFailure` (board navigation failure) was not triggered live; it calls the same `append()` as the verified paths.
- The toolbar's **Open board log** click was not driven through the UI; its IPC (`getBoardLogPath`) was invoked directly.
- A packaged (non-dev) build's bundled-root detection (`process.resourcesPath/assets/boards`) was not run.
