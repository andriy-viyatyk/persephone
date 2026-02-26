# US-037: Lightweight Rust Launcher

## Status

**Status:** Planned
**Priority:** High

## Summary

Create a lightweight Rust executable (~500KB) that acts as the entry point for file/URL opening. When js-notepad is already running, the launcher sends arguments via Named Pipe and exits instantly (<50ms). When not running, it spawns `js-notepad.exe` with the arguments.

## Why

- **Slow "Open with" experience** — opening a file via Windows Explorer context menu takes ~1 second because `js-notepad.exe` (Electron) must fully initialize even just to detect the existing instance and quit
- **Default browser registration prerequisite** — US-036 requires a fast executable for URL handling; users expect link clicks to be near-instant
- **WiX launcher working directory bug** — the current WiX MSI creates a stub launcher that doesn't pass the working directory, breaking tools like Git Extensions that use relative paths
- **Future-proofing** — a custom launcher gives full control over file associations, registry entries, and argument routing

## Background

### Current Behavior

When a file is opened via "Open with js-notepad" from Windows Explorer:
1. Windows runs `js-notepad.exe "C:\path\to\file.txt"`
2. Electron initializes (~1 second): loads Node.js, Chromium, V8
3. `requestSingleInstanceLock()` detects existing instance
4. Sends `argv` to existing instance via `second-instance` event
5. Second instance quits

Steps 2-5 take ~1 second even though the actual work (step 4) is trivial.

### Proposed Behavior

1. Windows runs `js-notepad-launcher.exe "C:\path\to\file.txt"` (<1ms to start)
2. Launcher tries to connect to `\\.\pipe\js-notepad` (~1ms)
3. **Pipe exists (app running):** send argument, exit (~10ms total)
4. **Pipe doesn't exist (app not running):** spawn `js-notepad.exe` with args, exit (~50ms total)

## Acceptance Criteria

- [ ] Rust launcher binary < 1MB, starts in < 50ms
- [ ] When js-notepad is running: file/URL delivered via Named Pipe in < 50ms
- [ ] When js-notepad is not running: spawns `js-notepad.exe` with correct arguments and working directory
- [ ] js-notepad main process creates Named Pipe server on startup
- [ ] js-notepad handles pipe messages (open file / open URL in browser)
- [ ] Relative file paths resolved correctly (working directory preserved)
- [ ] Multiple rapid invocations handled correctly (concurrent pipe connections)
- [ ] Launcher works from any working directory
- [ ] No regressions to existing file opening behavior
- [ ] Launcher passes all argument types: file paths, URLs (http/https), relative paths

## Technical Approach

### Component 1: Named Pipe Server (Node.js, main process)

Add to `src/main/` — a Named Pipe server that listens for incoming file/URL requests.

**Pipe name:** `\\.\pipe\js-notepad` (or `\\.\pipe\js-notepad-<username>` for multi-user systems)

**Protocol:** Simple line-based text protocol:
```
OPEN <path-or-url>\n
CWD <working-directory>\n
END\n
```

**Message handling:**
- If argument starts with `http://` or `https://` → route to browser editor (`openUrlInBrowserTab`)
- Otherwise → treat as file path, resolve relative to CWD, open in text editor

**Lifecycle:**
- Create pipe server in `app.whenReady()` callback
- Destroy on `app.on('will-quit')`
- Handle `EPIPE`/`ECONNRESET` gracefully (client may disconnect before response)

### Component 2: Rust Launcher

A standalone Rust project (separate directory, e.g., `/launcher/`).

**Build:** Compiled to `js-notepad-launcher.exe` using `cargo build --release`

**Logic:**
```
1. Collect command-line arguments (skip argv[0])
2. Get current working directory
3. Try to connect to \\.\pipe\js-notepad (timeout: 100ms)
4. If connected:
   a. Send: "CWD <cwd>\n"
   b. For each argument: Send "OPEN <arg>\n"
   c. Send: "END\n"
   d. Exit with code 0
5. If pipe not found (app not running):
   a. Resolve path to js-notepad.exe (relative to launcher location)
   b. Spawn js-notepad.exe with all original arguments
   c. Set working directory to current CWD
   d. Detach child process (don't wait)
   e. Exit with code 0
6. If pipe connection fails (other error):
   a. Fall back to spawning js-notepad.exe
```

**Rust dependencies (minimal):**
- `std::os::windows::io` — Named Pipe client
- `std::process::Command` — spawn child process
- `std::env` — args, current_dir
- No async runtime needed (synchronous pipe I/O is fine for a launcher)

### Component 3: Integration

**Main process changes (`src/main/main.ts` or new `src/main/pipe-server.ts`):**
- Start Named Pipe server
- On message received: send IPC to renderer to open file/URL
- Handle `app.on('second-instance')` as fallback (keep existing behavior for direct `js-notepad.exe` invocations)

**Renderer changes (`src/renderer/store/page-actions.ts` or `pages-store.ts`):**
- Handle new IPC event for "open file from pipe" / "open URL from pipe"
- Reuse existing `handleOpenFile` / `openUrlInBrowserTab` logic

## Concerns

1. **Multi-user systems:** If multiple users run js-notepad on the same machine, pipe name must be unique per user. Use `\\.\pipe\js-notepad-<username>` or `\\.\pipe\js-notepad-<SID>`.

2. **Pipe server crash recovery:** If js-notepad crashes without cleaning up the pipe, the OS should release it. But if not, the launcher would fail to connect and fall back to spawning — acceptable behavior.

3. **Build integration:** The Rust launcher needs to be compiled separately from the Electron app. The installer (US-038) must include both `js-notepad.exe` and `js-notepad-launcher.exe`. The build pipeline (`npm run make`) should trigger `cargo build` as a pre-step.

4. **Security:** The Named Pipe is local-only (no network access). Could add a simple shared secret or validate that the connecting process is from the same user, but likely unnecessary for a local desktop app.

5. **macOS/Linux:** This task is Windows-only. If cross-platform support is needed later, Unix domain sockets are the equivalent of Named Pipes.

6. **Existing `requestSingleInstanceLock`:** Keep it as a fallback — if someone runs `js-notepad.exe` directly (not through the launcher), the existing single-instance behavior should still work.

## Files to Create/Modify

- `/launcher/` — NEW: Rust project directory
  - `/launcher/Cargo.toml` — Rust project config
  - `/launcher/src/main.rs` — Launcher source code
- `src/main/pipe-server.ts` — NEW: Named Pipe server
- `src/main/main.ts` — Start pipe server on app ready
- `src/ipc/pipe-ipc.ts` — NEW: IPC channels for pipe messages (main → renderer)
- `src/renderer/store/page-actions.ts` — Handle incoming pipe messages (open file/URL)

## Implementation Progress

### Phase 1: Named Pipe Server
- [ ] Create `pipe-server.ts` with `net.createServer` on Named Pipe
- [ ] Parse protocol messages (CWD, OPEN, END)
- [ ] Route file paths to `handleOpenFile` / file opening logic
- [ ] Route URLs to `openUrlInBrowserTab`
- [ ] Start server in `main.ts` on `app.whenReady()`
- [ ] Clean shutdown on `app.will-quit`

### Phase 2: Rust Launcher
- [ ] Set up Rust project in `/launcher/`
- [ ] Implement Named Pipe client connection
- [ ] Implement argument forwarding protocol
- [ ] Implement fallback spawning of `js-notepad.exe`
- [ ] Compile and test

### Phase 3: Integration & Testing
- [ ] Test: open file when app is running (pipe path)
- [ ] Test: open file when app is not running (spawn path)
- [ ] Test: open URL when app is running
- [ ] Test: relative path resolution with CWD
- [ ] Test: multiple rapid invocations
- [ ] Test: concurrent pipe connections
- [ ] Verify existing `requestSingleInstanceLock` still works as fallback

## Notes

### 2026-02-26
- Task created as prerequisite for US-036 (Default Browser Registration) and US-038 (NSIS Installer)
- Named Pipes chosen over TCP sockets (no port management, faster, Windows-native)
- Rust chosen for minimal binary size and instant startup (Go would produce ~5-8MB binary)
- Protocol kept intentionally simple (text-based, no serialization library needed)

## Related

- Prerequisite for: US-036 (Register as Default Browser)
- Related: US-038 (NSIS Installer Migration) — installer must include the launcher
