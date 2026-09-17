# US-1438: `clipboard-watch` subcommand in persephone-snip

Status: Planned. Investigation and protocol design are complete; implementation is intentionally
not included in this task.

Epic: [EPIC-104: Clipboard tracker](../../epics/EPIC-104.md)

## Goal

Add a long-lived `clipboard-watch` subcommand to the existing Windows helper
`snip-tool/target/release/persephone-snip.exe`. It will register an invisible Win32 clipboard
format listener, emit one JSON change event per `WM_CLIPBOARDUPDATE`, answer health-check pings on
stdin, and shut down when stdin closes.

This task is Rust-only. It must not add a crate, change TypeScript, poll the clipboard, or reopen
the settled EPIC-104 decisions D1, D2, D3, D6, or D12.

## Background

### Existing code and verified constraints

- `snip-tool/src/main.rs:25-30` dispatches on the first CLI argument. The existing branches call
  `clipboard::read()` for `clipboard-read` and `clipboard::write()` for `clipboard-write`; the
  default branch remains the screen-snipping path.
- `snip-tool/src/clipboard.rs:58-70` already has `open_clipboard_retry()`, retrying a busy shared
  clipboard ten times with a 50 ms delay. The same file already parses `CF_HDROP` and its
  `Preferred DropEffect` value at `read_clipboard_locked()` (`snip-tool/src/clipboard.rs:102-153`)
  and provides JSON escaping at `json_escape()`.
- `snip-tool/Cargo.toml:8-16` already enables `Win32_Foundation`,
  `Win32_Graphics_Gdi`, `Win32_UI_WindowsAndMessaging`, `Win32_System_LibraryLoader`,
  `Win32_System_DataExchange`, and `Win32_System_Memory`. The `windows-sys` 0.52 source in the
  local Cargo registry exposes every API needed here under those features, including
  `AddClipboardFormatListener`, `RemoveClipboardFormatListener`, `EnumClipboardFormats`,
  `GetClipboardData`, `GetClipboardFormatNameW`, `GetClipboardSequenceNumber`,
  `RegisterClipboardFormatW`, `CreateWindowExW`, `RegisterClassExW`, `GetMessageW`,
  `DispatchMessageW`, `PostMessageW`, and `HWND_MESSAGE`. No feature addition is planned.
- `src/main/sidecar-process.ts:26-50` defines readiness as a trimmed, non-empty stdout line and
  sends every such line to the service `log` callback. `src/main/sidecar-process.ts:218-231`
  recognizes readiness and then keeps forwarding lines, so US-1439 can parse change and pong JSON
  in its log callback without changing `SidecarProcess` for this task.
- `src/main/mneme-service.ts:24-32` and `:102-108` are the lifecycle pattern: configure a
  `SidecarProcess`, wait for readiness, and spawn with `{ windowsHide: true }`. The watcher uses
  the same hidden-spawn option, but its native window is message-only as well.
- `src/main/clip-service.ts:15-51` confirms that the existing `clipboard-read` helper is the
  Electron-side workaround for reading `CF_HDROP`; Electron's clipboard API is not the source of
  the file-list capture in this epic.
- `electron-builder.yml:20-32` already packages the whole `persephone-snip.exe` beside the main
  executable, and `src/main/snip-service.ts:9-14` already resolves that path in packaged and dev
  builds. A new binary and packaging entry are not needed.
- `snip-tool/Cargo.toml:21-26` sets the release profile to `panic = "abort"`. Runtime Win32 and
  I/O failures therefore need explicit error handling and a clean error exit; the implementation
  must not use `unwrap`/`expect` on long-lived listener, thread, clipboard, or stdout operations.

### Win32 behavior verified for this design

- Microsoft recommends a clipboard format listener for new monitoring code. Calling
  `AddClipboardFormatListener(hwnd)` registers a window, and Windows posts `WM_CLIPBOARDUPDATE`
  when clipboard contents change. Registration remains until
  `RemoveClipboardFormatListener(hwnd)` is called. This is notification-driven and does not use a
  timer or sequence-number polling.
- A message-only window is created by passing `HWND_MESSAGE` as `hWndParent` to
  `CreateWindowExW`. Microsoft documents that message-only windows are not visible, have no
  z-order, cannot be enumerated, and only dispatch messages. The implementation must not add
  `WS_VISIBLE`, create a taskbar-capable top-level window, or show a console UI.
- `EnumClipboardFormats` requires the clipboard to be open and returns the next format ID in the
  clipboard's ordered format list. It enumerates metadata; the watcher will not call
  `GetClipboardData` for text, HTML, bitmap, or image formats.
- The three D6 facts are intentionally kept separate:
  - `ExcludeClipboardContentFromMonitorProcessing` is a registered format whose *presence* is the
    exclusion signal. Detect it with `IsClipboardFormatAvailable(formatId)`; do not interpret its
    data value.
  - `CanIncludeInClipboardHistory` is a registered format whose data is a serialized DWORD. Read
    its `HGLOBAL` with `GetClipboardData`, check that the locked block contains at least four bytes,
    and decode the DWORD. For an untrusted owner, `0` means do not include the clipboard item in
    history and `1` explicitly requests inclusion. A present value other than `0` or `1`, an
    unreadable handle, or a short block is malformed and will be treated as excluded for this
    security-sensitive feature. The optional `--trusted-pid` owner may bypass this marker so
    Chromium writes made by the application can be captured.
  - `CanUploadToCloudClipboard` is a separate Windows format with cloud-sync semantics; it is not
    one of the two D6 flags and is not part of this subcommand's exclusion contract.
- `RegisterClipboardFormatW` returns the existing ID when the named format is already registered,
  so registering the two D6 names at startup yields IDs that match other processes. Registered
  clipboard data is represented by an `HGLOBAL`, which is why the DWORD is read through
  `GlobalLock`/`GlobalSize`/`GlobalUnlock` and is never freed by the watcher.
- `GetClipboardSequenceNumber()` is a zero-argument User32 call that retrieves the 32-bit sequence
  for the current window station. Its documented operation has no `OpenClipboard` prerequisite;
  it reads the sequence number rather than clipboard data. It increments when clipboard contents
  change or the clipboard is emptied, with delayed rendering reflected when the change is rendered.
- Rust's `std::io::Stdout` handles share a globally synchronized output buffer. The implementation
  will additionally put a `BufWriter<Stdout>` and the last-emitted sequence in one shared mutex so
  the event thread and ping thread each write and flush a complete line before releasing the
  lock. This makes the line protocol explicit even though Rust stdout itself is synchronized.

Primary references: [Microsoft clipboard monitoring](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard),
[clipboard history formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats),
[AddClipboardFormatListener](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener),
[EnumClipboardFormats](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumclipboardformats),
[IsClipboardFormatAvailable](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-isclipboardformatavailable),
[GetClipboardData](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboarddata),
[RegisterClipboardFormatW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerclipboardformatw),
[GetClipboardSequenceNumber](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber),
[message-only windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features), and
[Rust `Stdout`](https://doc.rust-lang.org/stable/std/io/struct.Stdout.html).

## Protocol

This is the contract for US-1439. The helper writes UTF-8 to stdout and uses LF (`\n`) line
terminators. Every non-readiness stdout line is one complete JSON object. No diagnostic text may be
written to stdout; diagnostics and startup failures go to stderr.

### Readiness

After the message-only window has been created and `AddClipboardFormatListener` has returned
success, and before the message loop can emit any clipboard event, write exactly this line once:

```text
clipboard-watch: ready
```

The `SidecarProcess` readiness predicate must compare the trimmed line to this exact sentinel. No
initial snapshot or synthetic event is emitted at startup.

### Change event

For every `WM_CLIPBOARDUPDATE` handled by the main message-loop thread, write one object with this
shape:

```json
{
  "type": "clipboard-change",
  "sequence": 1234,
  "timestampMs": 1780000000123,
  "formats": [
    {"id": 13, "name": "CF_UNICODETEXT"},
    {"id": 49152, "name": "CanIncludeInClipboardHistory"}
  ],
  "exclusion": {
    "excludeClipboardContentFromMonitorProcessing": true,
    "canIncludeInClipboardHistory": {"present": true, "value": 0},
    "ownerPid": 1234,
    "ownerTrusted": false,
    "inspectionFailed": false,
    "excluded": true
  },
  "files": null
}
```

Field contract:

- `type` is the literal `clipboard-change`.
- `sequence` is the current `GetClipboardSequenceNumber()` value sampled while handling the
  message. It is a 32-bit unsigned decimal JSON number. The `WM_CLIPBOARDUPDATE` message carries no
  sequence number of its own, so this is the sequence observed at dispatch time.
- `timestampMs` is a 64-bit unsigned Unix-epoch timestamp in milliseconds, sampled by the watcher
  for this event. It is not a local formatted date string.
- `formats` is an array in the order returned by `EnumClipboardFormats`. Each entry has the numeric
  `id` and a `name`. Standard formats use their canonical `CF_*` name; registered formats use
  `GetClipboardFormatNameW`; `GetClipboardFormatNameW` returns 0 for predefined `CF_*` formats and
  only names registered formats, so the implementation needs a local ID-to-name table for the
  predefined formats it reports and must not treat that 0 return as an error. `name` is `null` only
  when no name can be obtained. The numeric ID is authoritative. The list can include
  Windows-synthesized formats, as documented for `EnumClipboardFormats`.
- `exclusion.excludeClipboardContentFromMonitorProcessing` is true exactly when that registered
  format is present. Its clipboard data is never read.
- `exclusion.canIncludeInClipboardHistory.present` reports whether that registered format is
  present. When false, `value` is `null`. When true and the data is a readable four-byte DWORD,
  `value` is the raw unsigned DWORD; otherwise `value` is `null` and `inspectionFailed` is true.
- `exclusion.ownerPid` is the process id returned by `GetClipboardOwner` and
  `GetWindowThreadProcessId`, or `null` when the clipboard has no usable owner window.
  `exclusion.ownerTrusted` is true only when that owner matches the optional pid supplied through
  `--trusted-pid`; it is false when no trusted pid was supplied or the owner cannot be resolved.
- `exclusion.inspectionFailed` is true when the watcher could not safely inspect the clipboard
  format list or either D6 format, including failure to open the clipboard after the existing
  retry policy. `formats` is then `[]`, and the event's authoritative `excluded` field is true.
- `exclusion.excluded` is the authoritative capture decision: it is true if the presence flag is
  true, if inspection failed, or if `CanIncludeInClipboardHistory` is present with any value other
  than exactly `1` while `ownerTrusted` is false. A trusted owner does not exempt the explicit
  `ExcludeClipboardContentFromMonitorProcessing` marker. US-1439 must skip the event entirely when
  this field is true. This fail-closed rule prevents malformed or unreadable privacy metadata from
  becoming a plaintext history item while allowing Chromium writes made by the trusted
  Persephone process.
- `files` is `null` when the event is excluded, when `CF_HDROP` is absent, or when no usable file
  list can be parsed. Otherwise it is the existing file-list shape:

  ```json
  {"paths":["C:\\work\\report.txt"],"dropEffect":"copy"}
  ```

  `paths` is the parsed UTF-16/legacy ANSI `CF_HDROP` list and `dropEffect` is `copy`, `cut`, or
  `none`, using the parser already in `snip-tool/src/clipboard.rs`. The file list rides in this
  event as the one D3 exception to the notifier rule. This avoids a follow-up `clipboard-read`
  race in which the OS clipboard could change between the notification and the read; the watcher
  still reads no text, HTML, image, or other payload. If file-list inspection fails, the event is
  conservative (`files: null`); it does not silently substitute a later clipboard's file list.

The event is emitted even when `excluded` is true, so the consumer receives the privacy decision and
the health check can distinguish a delivered excluded change from a deaf listener. `lastEmittedSequence`
in the pong is updated only after the complete event line has been written and flushed.

### Ping and pong

The second thread reads stdin with a line-buffered reader. A ping is exactly this JSON request after
trimming the line ending and surrounding whitespace:

```json
{"type":"ping"}
```

For each ping, it writes:

```json
{"type":"pong","sequence":1235,"lastEmittedSequence":1234}
```

`sequence` is a fresh `GetClipboardSequenceNumber()` call made while servicing that ping. It does
not open the clipboard. `lastEmittedSequence` is the sequence of the most recent change event
whose complete line was successfully written and flushed; it is `null` until the first event.
Unknown or malformed stdin lines are ignored. The consumer should treat a current sequence ahead
of `lastEmittedSequence` as evidence that the process is alive but the listener is not delivering
changes. These are DWORD values and can eventually wrap; the consumer's comparison must use
unsigned sequence arithmetic rather than assuming an unbounded integer.

#### Consumer-side stdin control

US-1439 must add a write path to `SidecarProcess` for the live child's stdin, such as a small
`writeLine(line: string): boolean` method that reports whether the line was delivered. The child is
held in the private `proc` field (`src/main/sidecar-process.ts:56`), and the current public API only
exposes `pending` (`:73`); `start()`, `restart()`, and `stopAndWait()` accept
`SpawnOptionsWithoutStdio` but expose no stdin writer (`:85`, `:102`). Without this consumer-side
extension, US-1439 cannot send the ping half of D12.

### Shutdown

When the stdin reader reaches EOF, it posts `WM_CLOSE` to the message-only window and does not
write a final protocol line. The main thread handles that message, destroys the window, calls
`RemoveClipboardFormatListener`, posts `WM_QUIT`, and returns with exit code 0 after all locked
stdout output has been flushed. US-1439 must also preserve intentional-shutdown ordering: either
call `SidecarProcess.stop()` first, which synchronously nulls `proc` before the close event
(`src/main/sidecar-process.ts:118-133`, with the stale-child guard explained at `:243-255`), or
add an equivalent intentional-shutdown guard before closing stdin. Otherwise the clean exit 0
still satisfies `wasCurrent && ready` and invokes `onUnexpectedExit` (`:268-270`), producing a false
unexpected-death report. The defined graceful watcher path is stdin closure; the consumer must not
present that path as an unexpected stop.

## Implementation Plan

1. Update `snip-tool/src/main.rs` only for module registration, dispatch, and the subcommand
   comment. The dispatch change is:

   ```rust
   // Before
   mod clipboard;
   // ...
   Some("clipboard-write") => clipboard::write(std::env::args().any(|a| a == "--cut")),

   // After
   mod clipboard;
   mod clipboard_watch;
   // ...
   Some("clipboard-write") => clipboard::write(std::env::args().any(|a| a == "--cut")),
   Some("clipboard-watch") => clipboard_watch::run(),
   ```

   The default no-argument snip path and existing subcommands must remain unchanged.

2. Add `snip-tool/src/clipboard_watch.rs`. Keep all Win32 listener and protocol state in this
   module. `run()` should:

   - Register the two D6 names with `RegisterClipboardFormatW`, failing to stderr and exiting
     nonzero if either ID is zero.
   - Register a small window class with an `unsafe extern "system"` window procedure, create it
     with `CreateWindowExW(..., HWND_MESSAGE, ...)`, and use no visible window style. The procedure
     only handles `WM_CLOSE`/`WM_DESTROY`; the main loop handles `WM_CLIPBOARDUPDATE` directly so
     it can access the output state without a global mutable callback pointer.
   - Parse an optional `--trusted-pid <pid>` argument and use the clipboard owner's process id to
     compute `ownerPid` and `ownerTrusted`; this pid is the only exemption from the
     `CanIncludeInClipboardHistory` marker.
   - Call `AddClipboardFormatListener` and check its BOOL result before printing the exact
     readiness line. Do not print readiness before registration succeeds.
   - Start the stdin reader only after the listener is ready. Give it the window handle and the
     shared output state; for a ping, sample `GetClipboardSequenceNumber` and serialize a pong; for
     EOF, post `WM_CLOSE` with `PostMessageW`.
   - Keep the main thread in `GetMessageW`/`DispatchMessageW`. On `WM_CLIPBOARDUPDATE`, run the
     event snapshot and serializer synchronously on this thread. Do not create a timer or call
     `GetClipboardSequenceNumber` from a polling loop.
   - Use `Arc<Mutex<OutputState>>` (or an equivalent single shared lock) containing a flushed
     stdout writer and the last emitted sequence. Both event and pong writers must hold the lock
     across the complete `write_all` plus `flush`; update the last sequence only after the event
     line succeeds. A broken stdout pipe is a termination error, not a panic.
   - On `WM_DESTROY`, remove the listener before `PostQuitMessage`. Handle `GetMessageW == -1`, class
     registration failure, window creation failure, listener registration failure, thread spawn
     failure, and output failure explicitly. Keep all normal protocol output on stdout and all
     error diagnostics on stderr.

3. Implement the event snapshot in `snip-tool/src/clipboard_watch.rs` using the existing helper
   ownership in `snip-tool/src/clipboard.rs`:

   - Make only the minimal existing helpers/constants needed by the watcher `pub(crate)`; in
     particular, reuse `open_clipboard_retry`, `CF_HDROP`, and the existing locked `CF_HDROP` parser
     rather than creating a second file-list parser. The visibility change is:

     ```rust
     // Before
     fn open_clipboard_retry() -> bool { /* existing retry policy */ }
     unsafe fn read_clipboard_locked() -> Option<(Vec<String>, &'static str)> { /* ... */ }

     // After
     pub(crate) fn open_clipboard_retry() -> bool { /* unchanged behavior */ }
     pub(crate) unsafe fn read_clipboard_locked() -> Option<(Vec<String>, &'static str)> {
         /* unchanged parser, shared by clipboard-read and clipboard-watch */
     }
     ```

   - Open the clipboard once for the event snapshot, retrying through the existing helper. While
     it is locked, enumerate all format IDs with `EnumClipboardFormats`, obtain registered names
     with `GetClipboardFormatNameW`, and check both D6 formats.
   - Read `CanIncludeInClipboardHistory` only as a four-byte DWORD from its global block. Never
     free or retain a clipboard-owned handle; unlock it before closing the clipboard. Use the
     existing `GlobalSize`/`GlobalLock` pattern in `clipboard.rs` as the local model.
   - If the event is not excluded and `CF_HDROP` is present, call the shared locked parser and
     serialize its paths/drop effect into `files`. Do not call `GetClipboardData` for any text,
     HTML, bitmap, image, or arbitrary registered content.
   - Close the clipboard on every successful open path, including inspection errors. If opening or
     inspecting fails, produce the defined fail-closed event rather than capturing a payload.
   - Build JSON with a small local serializer and the existing escaping convention; do not add
     `serde_json` or another dependency just for this protocol.

4. Keep `snip-tool/Cargo.toml`, `snip-tool/Cargo.lock`, `src/main/mneme-service.ts`,
   `src/main/clip-service.ts`, `src/main/snip-service.ts`, and `electron-builder.yml` unchanged.
   The existing Cargo feature set and packaged executable are sufficient. US-1439 must extend
   `src/main/sidecar-process.ts` with the stdin write path and intentional-shutdown handling
   described above, then use its `log` callback to distinguish the readiness sentinel from
   event/pong JSON.

5. Verification after implementation is deliberately limited to the Rust workflow required by
   `doc/agents-common.md`: run `cargo build --release` from `snip-tool/`. Do not add unit tests or
   a test harness for this task. Runtime verification should use the acceptance criteria below and
   the existing consumer in US-1439, not a new TypeScript change in this task.

## Concerns / Open questions

All design questions for this task are resolved by EPIC-104 D1, D2, D3, D6, and D12; the items
below are implementation risks to preserve, not questions requiring a new design decision.

- **Fail-closed privacy behavior.** Reading a malformed `CanIncludeInClipboardHistory` block as an
  allow signal would risk writing secrets. The plan makes only an exact DWORD `1` an allow signal
  for untrusted owners; a trusted owner may bypass Chromium's `0` marker, but never the explicit
  `ExcludeClipboardContentFromMonitorProcessing` marker. Short blocks and unreadable handles still
  exclude the event.
- **Clipboard contention.** `WM_CLIPBOARDUPDATE` can arrive while the producer is finishing its
  clipboard transaction. The existing 10 × 50 ms retry is reused. If it still cannot inspect the
  clipboard, the event is delivered with `inspectionFailed: true` and is not captured.
- **Message-loop backpressure.** stdout is a pipe, and a slow consumer can make a flushed event
  write block the main message thread. That is intentional protocol backpressure; D12's pong then
  exposes a process that remains alive but is not delivering events. The watcher must not add a
  polling thread to work around it.
- **DWORD sequence wrap.** Windows documents a 32-bit sequence number. The protocol reports the
  raw values and does not claim they are unbounded; US-1439 must compare them with wrap-safe
  unsigned arithmetic.
- **Dispatch-time sequence.** `WM_CLIPBOARDUPDATE` has no sequence field. If several changes are
  queued before dispatch, each handled message still yields one event, but its sequence and
  metadata are the clipboard state observed at that dispatch. This is inherent in the selected
  Win32 notification API and is preferable to polling or reading unrelated payloads.
- **`panic = "abort"`.** Any unchecked runtime `unwrap`/`expect` would terminate the watcher
  without listener cleanup. Startup, thread, Win32, clipboard, and output operations must return
  controlled errors or initiate the defined shutdown path.
- **File-list event size.** Including `CF_HDROP` avoids a stale follow-up read but can make an event
  line large. The writer must keep it as one locked, flushed JSON line. The consumer should parse
  complete lines only and treat a malformed/oversized line as a capture failure rather than guessing
  at a partial path list.

## Acceptance Criteria

- [ ] `clipboard-watch` is dispatched by `snip-tool/src/main.rs`; no new Rust crate or Cargo feature
      is added, and existing commands/build packaging remain intact.
- [ ] The watcher creates a message-only `HWND_MESSAGE` window, registers it with
      `AddClipboardFormatListener`, handles `WM_CLIPBOARDUPDATE`, and uses no timer or polling.
- [ ] The process has no visible/taskbar window. The readiness sentinel is emitted exactly once,
      only after listener registration and before any event.
- [ ] Every handled clipboard update emits one valid JSON line with `type`, 32-bit `sequence`,
      Unix-millisecond `timestampMs`, ordered available `formats`, both D6 decisions, the
      clipboard `ownerPid`/`ownerTrusted` fields, and the optional parsed `CF_HDROP` file list.
      Text/HTML/image payloads are never read.
- [ ] `ExcludeClipboardContentFromMonitorProcessing` is a presence check; its data is not read.
      `CanIncludeInClipboardHistory` is decoded as a serialized DWORD; only exact value `1`
      allows capture for untrusted owners, while the configured trusted owner may bypass that
      marker. Missing, malformed, and inspection-failure cases follow the documented fail-closed
      behavior.
- [ ] The stdin reader is on a second thread. Each exact ping gets a pong containing a fresh OS
      sequence and the last fully emitted event sequence; both threads produce whole, non-interleaved
      stdout lines safely.
- [ ] stdin EOF causes `WM_CLOSE`, listener removal, window destruction, message-loop exit, stdout
      flush, and exit code 0, with no final protocol line.
- [ ] A release build succeeds with `cargo build --release` from `snip-tool/`.

## Files Changed

| File | Planned change |
|------|----------------|
| `snip-tool/src/main.rs` | Add the `clipboard_watch` module and `clipboard-watch` dispatch branch. |
| `snip-tool/src/clipboard_watch.rs` | New listener, message loop, protocol serializer, D6 inspection, file-list event handling, ping thread, and shutdown path. |
| `snip-tool/src/clipboard.rs` | Minimal `pub(crate)` visibility changes so the watcher reuses the existing retry and `CF_HDROP` parser. |
| `doc/tasks/US-1438-clipboard-watch-subcommand/README.md` | This implementation contract and investigation record. |

Files that need **no changes** for US-1438: `snip-tool/Cargo.toml`, `snip-tool/Cargo.lock`,
`snip-tool/build.rs`, `src/main/mneme-service.ts`,
`src/main/clip-service.ts`, `src/main/snip-service.ts`, `electron-builder.yml`,
`doc/active-work.md`, and `doc/epics/EPIC-104.md`.
