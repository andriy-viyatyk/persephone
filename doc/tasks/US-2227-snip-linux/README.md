# US-2227: Screen snip on Linux

## Goal

Enable interactive screen snipping on Linux using the desktop screenshot portal, preserving Windows behavior. This task belongs to [EPIC-215](../../epics/EPIC-215.md).

## Background

EPIC-215 records a GNOME Wayland measurement: the interactive Screenshot portal returns a PNG file URI on success and response 2 on Escape. Its Response is unicast to the calling bus connection, so the caller subscribes before the call on that connection. GNOME also saves the image in `~/Pictures/Screenshots/` and copies it to the clipboard; attempt to delete the returned file after reading it, while the clipboard side effect remains.

`snip-tool/src/main.rs` routes Windows commands to Win32 modules, and its non-Windows `main` currently exits 1 for every invocation. The Windows default capture writes only PNG bytes to stdout; cancellation exits 1. `snip-tool/Cargo.toml` puts `png` and `windows-sys` under Windows and already optimizes release size. `src/shared/platform.ts` supplies `helperExecutableName`; `src/main/snip-service.ts#getSnipToolPath` resolves the development release binary and packaged sibling. `startScreenSnip` gates on `getPlatformFeature`, hides normal windows, waits 200 ms, spawns with no arguments, buffers stdout, converts it with `nativeImage`, and restores in `finally`. Nonzero exit, empty output, and spawn error currently all become null; stderr chunks and spawn errors are already logged. `openWindows.hideWindows/showWindows` operate on non-board windows and show every such window afterwards, including ones hidden before the call. Preserve that existing Windows behavior rather than claiming all windows are hidden or their original visibility is restored.

`src/shared/platform-features.ts` owns the feature matrix and unavailable reason; `screen.snip` is currently Windows-only. It describes platform offerings, not helper health. `src/ipc/main/clipboard-handlers.ts` checks the feature before forwarding `startScreenSnip`; `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` reads it when mounted, and `src/renderer/scripting/ai-vision/namespaces/shell.ts#describeShell` reads it when describing the shell. `src/renderer/api/shell/snip-to-new-page.ts#snipToNewPage` creates an Image View page only for a non-null result. A missing or failed helper returns null without changing feature availability.

The [portal Request specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Request.html) defines the predictable path from the connection's unique name and a unique, unguessable token, recommends verifying the returned handle, and defines the response tuple. [dbus-rs](https://docs.rs/crate/dbus/0.9.12) provides a blocking session connection and its `vendored` feature builds libdbus without a system development package; its [blocking connection](https://docs.rs/dbus/0.9.12/dbus/blocking/struct.Connection.html) supports adding a match and processing signals. Choose `dbus` 0.9 with `vendored` on Linux only: this avoids an application async runtime and extra Ubuntu development packages; static libdbus has a size cost, so measure the release binary rather than claiming it is smaller. Use a proper URI parser, not string slicing, for escaped and non-ASCII paths.

## Implementation Plan

- [ ] **Linux backend owner: `snip-tool/src/screenshot_linux.rs` (new).** Add Linux-only `dbus` 0.9 with `vendored` and a URL crate in `snip-tool/Cargo.toml`, update `snip-tool/Cargo.lock`. Open one blocking session connection. Generate a valid unpredictable `handle_token` (OS randomness; valid D-Bus path characters), derive `/org/freedesktop/portal/desktop/request/<unique-name-with-colon-removed-and-dots-replaced>/<token>`. Register a `org.freedesktop.portal.Request.Response` signal match **before** the method call, on this same connection; queue matching messages even if delivered while the call awaits its reply. Call destination `org.freedesktop.portal.Desktop`, path `/org/freedesktop/portal/desktop`, interface `org.freedesktop.portal.Screenshot`, method `Screenshot`, arguments empty parent-window string and `a{sv}` containing `interactive=true` and `handle_token`. Match the actual returned object path, interface, member and portal sender; install a broad Response match before the call so a different returned path can be handled without a lost-signal race, and reject unrelated messages. Do not wait only on a method reply: process the connection until the matching Response arrives, allowing an indefinitely open picker. Do not add a Tokio runtime.
- [x] Decode `(u32, a{sv})`: any nonzero response is cancellation (exit 0 with empty stdout and no stderr); for 0 require a string `uri`, parse it as a local `file://` URL with percent decoding, rejecting malformed, non-file and remote-host URIs. Read the bytes before writing stdout, then attempt to delete the returned file. If deletion fails, write a warning to stderr but still write the PNG and exit 0; do not discard a successful capture. Bus, missing portal, invalid URI and read errors exit 1 with diagnostics on stderr and no stdout. Do not delete arbitrary paths from invalid results. Write and flush the original PNG bytes with `std::io::Write`; an output failure exits 1.
- [x] **Dispatch owner: `snip-tool/src/main.rs`.** Add `#[cfg(target_os = "linux")] mod screenshot_linux` and Linux `main` that accepts only no arguments for capture; any subcommand exits 1 with stderr and no stdout. Keep the existing unsupported stub for other non-Windows platforms and every Windows branch unchanged. Update the top-level usage comment to describe platform-specific cancellation and command support.

  ```rust
  // Before: every non-Windows invocation is unsupported.
  #[cfg(not(windows))] fn main() { /* unsupported */ }
  // After: Linux no-argument capture delegates to screenshot_linux;
  // Linux arguments and other non-Windows targets remain unsupported.
  ```

- [x] **Availability owner: `src/shared/platform-features.ts`.** Change only the `screen.snip` Linux matrix slot to true. Existing consumers reuse `getPlatformFeature`; do not add runtime health or platform branches at call sites. This shared matrix file is also touched by US-2229: preserve the other agent's edits and do not change its other files.
  ```ts
  // Before
  "screen.snip": { win32: true, linux: false, darwin: false, unsupported: false },
  // After
  "screen.snip": { win32: true, linux: true, darwin: false, unsupported: false },
  ```

- [x] **Capture lifecycle owner: `src/main/snip-service.ts`.** Reuse `getSnipToolPath`, `openWindows.hideWindows/showWindows`, the existing 200 ms delay, spawn buffering and `nativeImage.createFromBuffer`. The promise already waits for the helper to close, so Linux windows remain hidden while the portal picker is open and the existing `finally` restores them on cancellation or error. Preserve that timing unless Claude's VM check demonstrates a Linux-specific need; preserve Windows timing. Stderr chunks are already logged with `console.error`; make a nonzero helper exit diagnosable there, including its stderr, without duplicating it, and keep exit 0 with empty output silent. A missing helper or failed capture returns null and never changes `platformFeatures`; the app stays up. Keep the existing Windows behavior. No new protocol, runtime-availability machinery, `await import()` or import-zone wrapper is needed; no roadmap section 2.3 god file grows.
- [x] **Documentation owner:** update `doc/linux-development.md` Rust helper section: build command remains the same, Linux no-argument capture now uses the portal; unsupported subcommands remain unsupported. Record the `vendored` build requirement if the actual Cargo build exposes one, and no packaging claims. Update `assets/guides/screens/header.md` to describe the picker and GNOME file/clipboard side effects, attempted deletion of the returned file, including the possibility of a warning; avoid promising other desktops. If any user-visible message is needed, put English in `src/shared/i18n/en/`; translations are deferred to epic close. Run `npm run guides:check` for guide changes.
- [x] **UI test scope:** no automated picker, fake D-Bus service, unit-test harness or new UI test is added. No existing snip-specific `windows` tags were found in `integration-test/tests/shell/` or `integration-test/tests/boards/excalidraw/`; none can be dropped for this task. Preserve unrelated Windows tags.

**Progress note:** Cargo could not resolve `dbus` because the crates.io index is unavailable in this environment, so `Cargo.lock` is not updated and the backend plan item remains open. `npm run guides:check` also hit the documented sandbox `spawn EPERM` limitation.

## Concerns

- GNOME copies the image to the clipboard and saves it under `~/Pictures/Screenshots/`. The helper attempts to remove the returned file; a deletion failure leaves the file in place, warns on stderr, and still returns the PNG.
- The existing 200 ms delay was chosen for Windows; Claude verifies it with the portal picker. The existing window helpers exclude board windows and do not preserve individual hidden states.
- The Request handle mismatch case is race-sensitive: subscribe broadly before calling and filter by the returned handle after the reply. A nonzero portal response is cancellation, not an error.
- Measure the release helper's size and dependencies in the VM. `dbus` vendored adds native code; Linux packaging remains deferred to Phase 4.

## Verification

**Implementer on Windows (no app or Linux commands):**

```powershell
npm run typecheck
npm run lint
npm run build-prod
npm run guides:check
cargo build --release --manifest-path snip-tool/Cargo.toml
```

`mneme` is untouched. Codex does not start Persephone or run Linux commands.

**Claude, Windows app:** verify both snip actions still work.

**Claude, Ubuntu 26.04 GNOME Wayland VM:** build the release helper and record its size and `ldd` output. Verify Snip Screen region selection opens an Image page and Persephone's normal windows remain hidden while the picker is open; Snip Persephone includes the window; Escape returns nothing and restores windows; the returned file is deleted; moving the helper aside does not crash the app. Check the existing 200 ms delay with the actual picker.

## Acceptance Criteria

- [ ] Linux interactive portal capture returns the PNG through the existing snip API and attempts to delete the returned file. Deletion failure warns on stderr but still returns the image.
- [ ] A nonzero portal response exits 0 without output; bus, portal, URI and read errors exit 1 with stderr. `startScreenSnip` returns null for either empty output or a nonzero exit, and a missing or failed helper does not crash the app.
- [ ] `screen.snip` is offered on Linux; it is not changed by runtime health. Snip Screen hides normal windows until capture ends, and Snip Persephone leaves them visible. Windows behavior and unsupported Linux subcommands remain unchanged.
- [ ] Windows checks and Claude's live Windows and VM checks above pass; GNOME clipboard and file effects are documented. Translations and epic-wide review remain deferred.

## Files Changed Summary

| File | Planned change |
| --- | --- |
| `snip-tool/Cargo.toml`, `snip-tool/Cargo.lock`, `snip-tool/src/main.rs`, `snip-tool/src/screenshot_linux.rs` | Linux dependencies, dispatch and portal client. |
| `src/shared/platform-features.ts` | Set the Linux `screen.snip` matrix slot to true. |
| `src/main/snip-service.ts` | Diagnose nonzero helper exits, preserving existing stderr logging and lifecycle. |
| `doc/linux-development.md`, `assets/guides/screens/header.md`, optional `src/shared/i18n/en/` | Build, user behavior and any new English text. |

**No changes:** US-2229-owned files other than the separately scoped `screen.snip` matrix entry in `src/shared/platform-features.ts`; `src/main/clip-service-linux.ts`, Win32 snip modules, `src/shared/platform.ts`, `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, `src/renderer/scripting/ai-vision/namespaces/shell.ts`, IPC contracts and handlers, renderer startup, `assets/languages/`, and packaging configuration. Existing consumers obtain the updated platform rule from `getPlatformFeature`.
