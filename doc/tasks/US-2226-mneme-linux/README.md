# US-2226: Mneme on Linux

Epic: [EPIC-215](../../epics/EPIC-215.md) · Status: implementation complete; Claude's Linux VM checks are pending.

## Goal

Enable Mneme on Linux, including model provisioning and sidecar lifecycle, while keeping Windows behavior unchanged. A missing or unstartable Linux helper must report a useful error through the existing sidecar status and notification path without crashing Persephone.

## Background

US-2224 measured `mneme model-update` downloading and verifying the model in `~/.config/persephone/data/mneme/models/` on Ubuntu 26.04 and CPU embedding with 768 dimensions. US-2225 built the helpers on Linux, made `mneme/build.rs` skip Windows resources on non-Windows targets, and added `helperExecutableName` in `src/shared/platform.ts`. `doc/linux-development.md` documents building `mneme/target/release/mneme`; Linux packaging remains Phase 4. ONNX Runtime's Linux library and glibc requirements remain a Phase 4 concern.

`mneme/src/model/mod.rs` `cache_base` already honors `ModelConfig.path`, else `dirs::config_dir()/persephone/data/mneme/models`; `model_dir` adds the manifest-derived model name. Thus the normal Linux default is the measured path, or under `XDG_CONFIG_HOME` when set. `scripts/dev-mneme-model.mjs` already mirrors this default and copies the two optional local model files, skipping existing ones. Model updates also run through Mneme's existing MCP `model_update`; no new downloader is needed. The sidecar config is `<userData>/data/mneme/mneme.toml`, while the default model cache is OS-config based: named and test profiles have separate config paths but share the default cache unless `model.path` is configured. Do not silently change that existing Windows or profile behavior.

`src/main/mneme-service.ts` resolves the development and packaged paths using `helperExecutableName`, starts `serve --port ... --config ...`, and waits for `listening on` through `SidecarProcess`. `SidecarProcess` catches synchronous spawn errors and asynchronous process errors, handles timeout, in-flight starts, stop and restart; `startMneme` converts its result to `MnemeStatus`. On Windows a missing `mneme.exe` therefore returns an error instead of throwing; it does **not** currently change `platformFeatures`. Unexpected exit broadcasts an error. `getMnemeStatus()` currently drops prior errors. `settings-effects.ts` reports a failed start via a notification. `memory.mnemeSidecar` is statically false on Linux; `McpSection` and `HeaderQuickSettingsPopover` consume it, while `settings-schema.ts` says Linux is unavailable. `MnemeStatus` and `eMnemeStatusChanged` already carry sidecar status across the existing IPC boundary.

## Implementation Plan

- [x] **Offer Mneme on Linux:** `src/shared/platform-features.ts` owns platform support. Change only the Mneme Linux matrix value; existing `getPlatformFeature` consumers in `src/main/mneme-service.ts`, `src/renderer/editors/settings/sections/McpSection.ts` and `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` then allow the same sidecar and controls on Linux. Do not add runtime health to the platform feature layer.

  ```ts
  // Before
  "memory.mnemeSidecar": { win32: true, linux: false, darwin: false, unsupported: false },
  // After
  "memory.mnemeSidecar": { win32: true, linux: true, darwin: false, unsupported: false },
  ```

- [x] **Reuse the existing lifecycle and error path:** `src/main/mneme-service.ts` owns sidecar startup and shutdown; it already reuses `helperExecutableName` and `SidecarProcess`. Preserve its readiness, config path, restart and stop behavior and the existing `MnemeStatus.error` result. `src/renderer/api/settings-effects.ts` `applyMneme` already reports failed starts with `api.mnemeFailedToStart`. A missing Linux binary follows the same path as a missing Windows binary. The settings section currently renders running/stopped and does not show the error; the existing notification is sufficient, so no settings status or IPC changes are planned. No per-platform collaborator is needed for an already portable lifecycle.
- [x] **Provisioning and wording:** Keep `mneme/src/model/mod.rs` `cache_base` and `model_dir`, and Mneme's existing `model_update` download flow. In `scripts/dev-mneme-model.mjs`, replace the Windows-only `mneme.exe model-update` hint with the platform-neutral `mneme model-update` hint; retain the copy rules. In `src/renderer/api/settings-schema.ts`, replace the Linux-unavailable sentence with platform-neutral sidecar wording, preserving the false default and separate MCP port. For example:

  ```ts
  // Before: Linux says "Mneme is unavailable on Linux."
  // After: "Persephone runs Mneme as a sidecar and connects over loopback HTTP."
  ```

  In `assets/guides/mneme.md`, replace the Windows-only executable description and explain first-run model download and the existing failure notification. In `doc/linux-development.md`, remove the stale Mneme-unavailable claim while retaining snip and packaging caveats. Review and correct Mneme availability wording in `src/renderer/editors/settings/settings-catalog.ts` and `src/renderer/scripting/ai-vision/namespaces/settings.ts` where needed; these own the settings catalog and agent help, respectively. Existing generic wording can stay. Put any new English UI messages in `src/shared/i18n/en/`; translations happen at epic close.
- [x] **UI test portability:** In `integration-test/tests/tools/mneme/mneme.test.mjs`, remove only `"windows"` from both tests' `requires: ["mneme", "windows"]`, retaining `"mneme"`. The first covers startup and shutdown; the second covers root browsing, text search and opening a document. Neither verifies vector parity. Add no unit tests or test harnesses.

### Verification

**Implementer on Windows (Codex; no Persephone startup or Linux commands):**

```powershell
npm run typecheck
npm run lint
npm run build-prod
cargo build --release --manifest-path mneme/Cargo.toml # only if the crate is touched
npm run guides:check # if assets/guides/ changes
```

A Rust change additionally requires `cargo test --manifest-path mneme/Cargo.toml`; no Rust change is currently planned. Do not build the unrelated snip crate. Linux CI is on demand only.

**Claude: live Windows app and Ubuntu 26.04 GNOME Wayland VM:**

- [ ] Build and sync per `doc/linux-development.md`; provision the model through Mneme Config in the VM.
- [ ] Enable, disable and restart Mneme. In the VM, move the development binary aside, attempt to enable Mneme, and confirm the app stays up and shows the start-failure notification. Restore the binary afterward.
- [ ] Use the same model version and a fresh, small synthetic Markdown corpus on Windows and Linux: `orchard.md` about apple trees and fruit, `ocean.md` about marine whales, and `rail.md` about train timetables, with distinct titles and no tied expected hits. Add the same root and wait for indexing and vector backfill. Search text `orchard` and vector `apple fruit trees` with the same top-k; record the ordered document URIs and require the same top document for each mode without vector-to-text fallback. Scores need not match. Remove the isolated roots afterward.
- [ ] Run `npm run test:ui -- --area tools/mneme --with mneme` on Windows and the VM, and confirm both Mneme tests run rather than skip.

## Concerns

- `platformFeatures` describes platform support, not helper health. `SidecarProcess` returns spawn errors and `settings-effects.ts` displays failed starts; keep that existing behavior and the persisted setting intact.
- The Linux model cache follows the OS config directory while named and test profiles have separate Mneme config files; preserve the existing cache and explicit model path behavior. Linux packaging and ONNX Runtime dependencies remain Phase 4 concerns.
- US-2229 is concurrently changing clipboard behavior. Coordinate edits to shared files, including `src/shared/platform-features.ts` and `src/renderer/api/settings-schema.ts`; change only Mneme entries and do not change clipboard-specific files.
- Reuse the named owners and helpers above. No protocol code, roadmap ?2.3 god-file growth, import-zone workaround or call-site platform special case is needed. Windows behavior stays unchanged.

## Acceptance Criteria

- [ ] Linux offers Mneme; its existing sidecar starts and stops, and model provisioning uses the established Linux cache.
- [ ] A missing Linux binary leaves Persephone running and produces the existing start-failure notification with a reason, as on Windows.
- [ ] Windows behavior remains unchanged; settings, agent help and guides no longer claim Mneme is unavailable on Linux.
- [ ] Both Mneme UI tests run without their Windows tags; Claude records matching top text and vector results and completes the live checks. Required Windows checks pass. Translations are deferred to epic close.

## Files Changed

| Path | Planned purpose |
|---|---|
| `src/shared/platform-features.ts` | Enable the Mneme Linux matrix entry |
| `src/renderer/api/settings-schema.ts` | Correct the Mneme setting comment |
| `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Correct Mneme catalog or help wording if needed |
| `src/shared/i18n/en/` | Any new English UI wording, if needed |
| `scripts/dev-mneme-model.mjs`, `assets/guides/mneme.md`, `doc/linux-development.md` | Platform-correct provisioning and feature guidance |
| `integration-test/tests/tools/mneme/mneme.test.mjs` | Remove two Windows-only test tags |

**No changes:** `mneme/src/model/mod.rs`, `mneme/src/config.rs`, `src/shared/platform.ts`, `src/main/mneme-service.ts`, `src/main/sidecar-process.ts`, `src/ipc/contracts/mcp-mneme.ts`, `src/renderer/api/mneme-status.ts`, `src/renderer/api/settings-effects.ts`, `src/renderer/editors/settings/sections/McpSection.ts`, `src/renderer/editors/settings/sections/McpSectionModel.ts`, `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, `snip-tool/`, packaging configuration, and US-2229 clipboard-specific files. Existing helpers and status handling already own their rules.
