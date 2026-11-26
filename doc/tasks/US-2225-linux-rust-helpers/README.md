# US-2225: Linux builds of the Rust helpers

## Goal

Build the Mneme and snip helpers for Linux and resolve their executable names by platform while preserving Windows behavior. This plan belongs to [EPIC-215](../../epics/EPIC-215.md); implementation awaits review.

## Background

EPIC-215 capture decision 4 records a successful Linux release build and CPU embedding for Mneme in the VM with the resource step skipped; snip-tool was not built. Decision 1 reserves the interactive portal Screenshot backend for US-2227. Linux clipboard history is to be hidden in US-2229; file clipboard is separate. Both helpers remain per-platform builds of one crate. Runtime and VM checks belong to Claude; Linux packaging is Phase 4.

`snip-tool/src/main.rs` dispatches six named commands; no argument and any unrecognized argument run the Windows snip overlay. All six modules, the `user32` DPI declaration, the encoder and its `Write` import are unconditional. `png` supports the Windows encoder and `windows-sys` supports Win32 code. Both `build.rs` files compile Windows resources unconditionally.

| Invocation | Caller in `src/main/` | Linux disposition |
|---|---|---|
| no argument (also unknown arguments) | `snip-service.ts` `startScreenSnip` | Feature disabled in `src/shared/platform-features.ts`; US-2227 implements capture. |
| `clipboard-read`, `clipboard-write [--cut]` | `clip-service-windows.ts`, selected by `clip-service.ts` | `clip-service-linux.ts` uses Electron clipboard formats and does not invoke the helper. |
| `clipboard-watch [--trusted-pid <pid>]` | `clipboard-service.ts` via `SidecarProcess.start` | Linux currently uses `clipboard-history-linux.ts`; US-2229 removes that sampler. |
| `sso-cookies <uri>` | `windows-sso.ts` `getSsoCookies`; `wantsWindowsSso` gates on Windows | Windows sign-in only. |
| `dialog-info <hwnd>`, `dialog-cancel <hwnd>` | `native-dialog-tracker.ts` `runDialogCommand` | `getNativeDialogState` and `cancelNativeDialogs` branch before reading the HWND or invoking the helper on non-Windows. |

Roadmap decision 1 names `src/shared/platform.ts`, a pure Node-compatible identity module; `src/main/platform.ts` does not exist. `snip-service.ts` exports `getSnipToolPath()`, already reused by the Windows file clipboard, clipboard watcher, SSO and dialog tracker. `mneme-service.ts` separately owns `getMnemeExePath()`. Both use `path.join`, `app.isPackaged`, `path.dirname(process.execPath)` for packaged builds, and their respective `target/release` directories in development. `screen.snip` and `memory.mnemeSidecar` remain unavailable on Linux in `src/shared/platform-features.ts` until their later tasks.

`electron-builder.yml` uses `extraFiles` for the two hard-coded `.exe` names beside the app; `extraResources` has no helper binaries and `asarUnpack` only names Windows koffi. Leave this Windows packaging unchanged; Phase 4 must decide Linux placement and packaging. The WSL rsync excludes `target`; `scripts/linux-vm/vm.ps1 sync` also excludes it and overlays the VM tree, so each Linux checkout needs its own builds.

## Implementation Plan

- [x] In `mneme/build.rs` and `snip-tool/build.rs`, keep the existing resource metadata and compile call intact inside a target-OS check. The build script owns this target rule; reuse Cargo's `CARGO_CFG_TARGET_OS`, not the host's `cfg!(windows)`. Keep `winres` as a build dependency so cross-target Windows resource builds still have it.

  ```rust
  // Before: resource compilation runs unconditionally.
  let mut res = winres::WindowsResource::new();
  // ... existing metadata and res.compile() ...

  // After: enclose that same block in this target check.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
      // existing resource block, unchanged
  }
  ```

- [x] In `snip-tool/Cargo.toml`, move both `png` and `windows-sys` with their existing versions and features under `[target.'cfg(windows)'.dependencies]`; retain `winres` under build dependencies. In `snip-tool/src/main.rs`, put `#[cfg(windows)]` on each of the six module declarations, `std::io::Write`, the `user32` extern block, DPI constant, existing `main`, `run_snip`, and `encode_png`. Preserve Windows dispatch and implementation verbatim. Add a complementary `#[cfg(not(windows))] fn main()` which writes `persephone-snip: not supported on this platform yet` to stderr and exits 1 for every invocation, with no stdout. This entry point owns the temporary unsupported behavior; it reuses the existing process exit convention and adds no protocol. US-2227 replaces the Linux no-argument behavior; all named commands remain absent there.

  ```rust
  // Before
  mod capture;
  fn main() { /* existing Windows dispatch */ }

  // After (apply the same gate to the other Windows items)
  #[cfg(windows)]
  mod capture;
  #[cfg(windows)]
  fn main() { /* existing Windows dispatch */ }
  #[cfg(not(windows))]
  fn main() {
      eprintln!("persephone-snip: not supported on this platform yet");
      std::process::exit(1);
  }
  ```

- [x] In `src/shared/platform.ts`, own the sole filename rule with a small exported function such as `helperExecutableName(baseName: "persephone-snip" | "mneme"): string`, reusing `isWindows`: return `${baseName}.exe` on Windows and `baseName` otherwise. This pure module imports neither Electron nor main-process code. In `src/main/snip-service.ts` `getSnipToolPath()` and `src/main/mneme-service.ts` `getMnemeExePath()`, replace only the filename literals with that function, retaining each existing path join and packaged/dev location. For example:

  ```ts
  // Before
  return path.join(__dirname, "../../snip-tool/target/release/persephone-snip.exe");
  // After
  return path.join(__dirname, "../../snip-tool/target/release", helperExecutableName("persephone-snip"));
  ```

  Apply the same filename to each packaged branch and use `helperExecutableName("mneme")` in both Mneme branches. `clip-service-windows.ts`, `clipboard-service.ts`, `windows-sso.ts` and `native-dialog-tracker.ts` already reuse `getSnipToolPath()` and need no import or call changes; `clip-service.ts` delegates to its OS collaborators. Preserve that shared path helper rather than adding logic to the roadmap §2.3 clipboard god file. No protocol, dynamic import, import-zone bypass, or new wrapper is needed.

- [x] In `doc/linux-development.md`, document Rust in both WSL and the VM: rustup minimal profile, `~/.cargo/bin` on the login-shell PATH, and `cargo --version` to verify. From each synced `~/persephone` checkout run `cargo build --release --manifest-path mneme/Cargo.toml` and `cargo build --release --manifest-path snip-tool/Cargo.toml`. State the resulting `mneme/target/release/mneme` and `snip-tool/target/release/persephone-snip` paths are where the dev app looks; sync excludes `target`, so build separately after syncing source. Mention the current unsupported snip stub and feature gates, and that packaging is deferred. VM already had Rust and WSL was installed with the minimal profile per EPIC-215; provide installation steps for a fresh environment, not a claim that they were executed here.

- [x] Codex (implementer), on Windows: run `cargo build --release --manifest-path mneme/Cargo.toml` and the same command for `snip-tool/Cargo.toml`, plus `npm run typecheck`, `npm run lint` and `npm run build-prod`. Codex cannot start Persephone, so it runs no UI tests and no Linux commands.
- [ ] Claude, after implementation: in the running Windows app, confirm snip and the Mneme sidecar still start; in the VM, build both crates and check the Linux stub with no argument and with a named command (stderr message, exit 1, empty stdout).

## Concerns

- The Linux stub intentionally fails for every argument, including unknown arguments; Windows retains its existing fallback to snip. It cannot be mistaken for cancellation success. US-2227 must replace the Linux capture path without enabling the other commands.
- The existing platform feature gates keep Linux snip and Mneme unavailable despite successful builds; enabling and missing-binary availability handling are later feature tasks, not this build task. Existing spawn failure handling remains in place.
- No new open decisions are required. The packaged Linux path is provisional until Phase 4; no Linux release is implied.

## Acceptance Criteria

- Both crates build in Windows release mode with their existing resource metadata and behavior; Claude confirms both release builds in the Ubuntu VM.
- Linux `persephone-snip` exists and every invocation exits nonzero, emits the clear unsupported message on stderr, and writes no stdout; Windows dispatch and all six commands are unchanged.
- Both helper filenames derive from the shared platform rule; all current snip helper callers resolve through the existing path helper, and development paths point to each crate's release output.
- Windows typecheck, lint, and affected UI checks pass; Linux feature availability and packaging stay unchanged.
- `doc/linux-development.md` gives reproducible Rust installation, PATH, sync and build instructions for both environments.

## Files Changed

| File | Planned change |
|---|---|
| `mneme/build.rs` | Gate Windows resources on Cargo target OS. |
| `snip-tool/build.rs`, `snip-tool/Cargo.toml`, `snip-tool/src/main.rs` | Gate resource compilation, dependencies and Windows entry point; provide unsupported non-Windows entry point. |
| `src/shared/platform.ts` | Own platform-specific helper filenames. |
| `src/main/snip-service.ts`, `src/main/mneme-service.ts` | Reuse filename rule in existing path resolvers. |
| `doc/linux-development.md` | Document Rust toolchain and builds in WSL and VM. |
| `doc/tasks/US-2225-linux-rust-helpers/README.md`, `doc/active-work.md`, `doc/epics/EPIC-215.md` | Plan and task links. |

**No changes:** `src/main/clip-service.ts`, `src/main/clip-service-windows.ts`, `src/main/clip-service-linux.ts`, `src/main/clipboard-service.ts`, `src/main/windows-sso.ts`, `src/main/native-dialog-tracker.ts`, `src/shared/platform-features.ts`, the individual `snip-tool/src/` Win32 modules, and `electron-builder.yml`. Linux portal capture, Mneme enablement, clipboard history changes, launcher and release packaging belong to later work.
