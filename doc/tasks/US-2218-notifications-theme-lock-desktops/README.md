# US-2218: Notifications, theme, lock and virtual desktops

## Goal

Make lock and unseen-mode wording accurate across platforms and report virtual-desktop placement as unavailable on Linux, preserving Windows behavior. Record the notification VM check and defer OS theme following. This task belongs to [EPIC-214](../../epics/EPIC-214.md).

## Background

- [Checklist](../../epics/EPIC-214-checklist.md) rows 24–27 cover notification activation, OS theme changes, lock and unsupported placement. The target is Ubuntu 26.04 GNOME, Electron native Wayland. WIN-31 and WIN-14 in the [inventory](../../reviews/multiplatform-2026-11/inventory.md) are code-based findings, not proof of GNOME behavior.
- Desktop notification paths: `src/main/version-service.ts` broadcasts `eUpdateAvailable`; `src/renderer/api/internal/RendererEventsService.ts` renders an in-app toast whose click opens About. `src/main/board-host/rpc/events.ts` sends `eBoardNotify` to that same service, which calls `ui.notify`; `src/renderer/api/ui.ts` also exposes toast notifications to scripts. These are not Electron desktop notifications. Websites and permitted board frames may use Chromium's web Notification API; `src/main/permission-policy-service.ts` and `src/main/site-permission-store.ts` own their permission decisions, with board grants in `src/shared/board/board-grant.ts`. Do not bypass those policies or duplicate a web notification. No app-authored `new Notification` path was found in `src`. In-app warning/error toasts and update/board toasts must retain their semantics.
- `package.json` has `desktopName: com.viyatyk.persephone.desktop`; `scripts/linux-vm/com.viyatyk.persephone.desktop` uses `assets/icon.png`, and `src/main/open-window.ts` uses `getAssetPath("icon.png")`. The VM entry is development setup, not a Linux package (packaging is a later phase). `src/main/open-windows.ts` owns normal window selection and showing/focusing.
- There is no OS-follow setting or Windows-only theme signal today. `src/renderer/api/settings-schema.ts` defaults `theme` to `persephone`; `src/renderer/editors/settings/sections/ThemeSection.ts` shows selectable tiles. `src/renderer/api/theme-service.ts` watches the setting; `src/renderer/theme/themes/index.ts` applies colors and calls `api.setNativeTheme`, and `src/ipc/main/app-handlers.ts` forces Electron `nativeTheme.themeSource` to the selected light/dark value. The app does not read `nativeTheme.shouldUseDarkColors` or subscribe to `updated`. Checklist row 25 is not applicable; OS following is a future feature for all platforms.
- `src/main/desktop-awareness.ts` initializes lock state with `powerMonitor.getSystemIdleState(60)`, subscribes to `lock-screen`/`unlock-screen`, and sends `eSessionLockChanged`; its messages say Windows. Without a virtual-desktop probe, `desktopVisible` uses shown/minimized/lock state and assumes current desktop. `src/main/mcp/ai-vision/main-session.ts`, `main-services.ts` and guides also say Windows; `main-unseen-mode.ts` already uses neutral language.
- `src/shared/platform-features.ts` already marks `desktop.virtualPlacement` unavailable on Linux. `src/main/virtual-desktop-manager.ts` owns Windows COM/registry lookup, selection and movement; `src/main/test-mode/desktop-placement.ts` installs the probe using a direct `process.platform` check. `src/main/test-mode/arguments.ts` parses `--desktop`, `controller.ts` rejects non-Windows after startup begins, and `src/test-host/launcher.ts` forwards the private `--test-desktop`. `integration-test/run.mjs` has its own runner option and Windows registry check. There is no virtual-desktop application setting or placement UI in the inspected settings schema/catalog; do not invent one. `src/main/mcp/ai-vision/main-root.ts` describes the visibility probe but does not advertise placement.
- US-2221 (`4a58b8e7`) uses `getPlatformFeature(...).available` in both a settings section and `settings-catalog.ts`; use that pattern where a control exists. No existing placement control or setting needs hiding.

## Implementation Plan

- [ ] **Notifications:** no notification code is planned. Chromium website and board Notification API paths retain the existing permission policy and `package.json` desktop identity. Claude checks an allowed website notification in the VM as described below; if it fails, Claude files a follow-up fix. Update and board toasts remain in-app.
- [x] **Theme:** checklist row 25 is not applicable because no OS-follow mode exists on any platform. Add this one line to `doc/tasks/backlog.md` during implementation: "Follow the OS light/dark theme, all platforms". Do not change theme code or add a mode in this task.
- [x] **Lock and wording:** `src/main/desktop-awareness.ts` continues to own Electron `powerMonitor` and the existing event contract. Change its lock/unlock messages to platform-neutral or per-platform wording, preserving Windows behavior and accurately describing the absent Linux workspace probe. Update lock descriptions in `src/main/mcp/ai-vision/main-session.ts` and `src/main/mcp/ai-vision/main-services.ts`, and wording and examples in `assets/guides/agents/events.md`, `assets/guides/agents/web-app-tests/unattended-runs.md`, `assets/guides/mcp-setup/available-tools.md`, and `assets/guides/agents/ai-vision.md`. Keep genuinely Windows-specific instructions identified as such. No unseen-mode setting exists in the settings schema or catalog; do not add one. If GNOME does not deliver lock events in the VM, Claude files a follow-up.
- [x] **Placement availability and CLI:** `src/shared/platform-features.ts` already owns `desktop.virtualPlacement` availability and its reason; retain Linux `false`. In `src/main/test-mode/desktop-placement.ts` replace the direct `process.platform` check with `getPlatformFeature("desktop.virtualPlacement").available`, retaining `desktopAwareness.setVirtualDesktopProbe` and Windows manager behavior. Remove the corresponding baseline entry from `eslint.config.mjs`. In `src/main/test-mode/controller.ts`, consult `getPlatformFeature` before selector resolution or test startup: unsupported explicit `--desktop` produces the feature reason and a nonzero usage result, without launching a test or silently using another desktop. Gate the private `--test-desktop` path in `src/main/test-mode/desktop-placement.ts` before resolution as well, with the same reason; retain `src/main/test-mode/instance-options.ts` syntax validation. Update `integration-test/run.mjs`'s existing help and early availability check, reusing the shared feature helper where Node type stripping permits; retain Windows registry verification. Keep `src/main/virtual-desktop-manager.ts` and its Windows adapter unchanged.
- [x] **Discoverability:** update `assets/guides/agents/web-app-tests/run-options.md`, `unattended-runs.md` and `assets/guides/whats-new.md` to qualify `--desktop` as Windows-only and explain the Linux limitation. `main-root.ts` `$help` should use `getPlatformFeature("desktop.virtualPlacement")` for a platform-aware explanation; `main-session.ts` and `main-services.ts` describe lock without implying a Windows-only API. Keep genuinely Windows-only examples identified as such. Follow US-2221's capability-based settings discovery if an actual placement control appears in concurrent work; do not add a dummy setting or UI merely to hide it.
- [ ] **Verification:** run `npm run typecheck`, `npm run lint`, `npm run guides:check`, and affected existing Windows `test:ui` areas `core/virtual-desktop`, `core/unseen-mode`, `core/desktop-awareness`, settings and browser permissions as applicable; keep Linux CI green. Do not add unit tests or test harnesses. If English catalog messages change, translate all built-in packs at epic completion.

### Representative changes

```ts
// src/main/test-mode/desktop-placement.ts, before
if (process.platform === "win32") desktopAwareness.setVirtualDesktopProbe(/* existing probe */);
// after: preserve the existing probe body, with availability owned centrally
if (getPlatformFeature("desktop.virtualPlacement").available) desktopAwareness.setVirtualDesktopProbe(/* existing probe */);
```

```ts
// src/main/test-mode/controller.ts, before
if (!isWindows) throw new Error("--desktop is supported only on Windows.");
// after, before selector resolution and launching
const availability = getPlatformFeature("desktop.virtualPlacement");
if (!availability.available) throw new Error(`--desktop: ${availability.reason}`);
```

## Concerns / Open questions

- GNOME may restrict activation and lock event delivery by session; the VM checks below determine actual behavior. Do not claim workspace detection without a probe. The initial idle-state read is not a guarantee that all Linux sessions expose lock state.
- No new board rules or protocol code; board rules stay in `src/shared/board/` and registries. Roadmap §2.3 god files only shrink; move work to focused collaborators. Respect import zones: no `await import()` or wrapper to bypass them. If any `window.persephone` surface changes, bump `BOARD_BRIDGE_VERSION` and add its history line. Strict-folder null fixes are type-only unless recorded here as a behavioral change. Remove replaced `process.platform` allowlist entries, never add new ones.

### Claude's VM checks (not implementation steps)

On Ubuntu 26.04 GNOME Wayland with Electron native Wayland, check an allowed website notification appears under Persephone's name and icon in GNOME's list and clicking it focuses the app; if this fails, file a fix. Row 25 is not applicable: there is no OS-follow mode. Lock and unlock and inspect event history, `main.session.locked` and `$help`; if lock events do not fire, file a follow-up. Check unseen-mode limitations. Inspect guides; run `--desktop` and private placement paths to confirm a clear unavailable diagnostic and no accidental placement or test run. Confirm desktop visibility does not claim workspace detection. Record any compositor/session limitations.

## Acceptance Criteria

- No notification implementation changes are planned; Claude checks GNOME website notification identity, icon and activation and files a fix if needed.
- Checklist row 25 is recorded as not applicable, and `doc/tasks/backlog.md` contains the single all-platform OS-theme-following idea after implementation.
- Lock events retain the existing lifecycle; accurate platform-neutral or per-platform wording reaches event text, MCP `$help` and affected guides. Claude files a follow-up if GNOME lock events do not fire.
- Linux placement and `--desktop` use existing shared feature availability and are explained before use in CLI/MCP/guides; no Windows COM operation is attempted. Windows placement behavior remains unchanged.
- Required static checks and affected existing Windows UI areas pass; Claude owns Linux runtime and VM checks. If English catalog messages change, translation is deferred to epic completion.

## Files Changed

| Path | Planned change |
|---|---|
| `doc/tasks/backlog.md` | Add one all-platform OS-theme-following idea during implementation |
| `src/main/test-mode/desktop-placement.ts`, `src/main/test-mode/controller.ts`, `eslint.config.mjs` | Use feature availability for probe and early diagnostics; remove replaced platform-check baseline |
| `src/main/desktop-awareness.ts`, `src/main/mcp/ai-vision/main-session.ts`, `src/main/mcp/ai-vision/main-services.ts`, `src/main/mcp/ai-vision/main-root.ts` | Lock wording and capability-aware visibility help |
| `integration-test/run.mjs` | Existing runner's early unavailable diagnostic and help |
| `assets/guides/agents/events.md`, `assets/guides/agents/web-app-tests/unattended-runs.md`, `assets/guides/agents/web-app-tests/run-options.md`, `assets/guides/agents/ai-vision.md`, `assets/guides/mcp-setup/available-tools.md`, `assets/guides/whats-new.md` | Accurate platform wording and limitations |

**No changes planned:** `src/main/virtual-desktop-manager.ts`, `src/shared/platform-features.ts`, `src/main/test-mode/instance-options.ts`, `src/main/permission-policy-service.ts`, `src/main/site-permission-store.ts`, `src/shared/board/board-grant.ts`, `src/main/board-host/rpc/events.ts`, `src/main/version-service.ts`, `src/renderer/api/ui.ts`, `src/main/unseen-mode.ts`, `src/preload-webview/page-visibility-shim.ts`, `src/test-host/launcher.ts`, theme code, IPC contracts and board bridge. Their existing capability, permission, toast, theme, visibility and forwarding behavior is reused.

## VM results (Claude, 2026-11-26)

Ubuntu 26.04, GNOME Wayland, dev build. Checklist rows 24–27.

| Row | Check | Result |
|-----|-------|--------|
| 24 | Desktop notification | **Partial.** A `localhost` page granted notification permission shows its notification in GNOME's list as "Persephone (Development)" with the app icon and a dock badge, and the page's `onclick` fires on click. Clicking does not restore or focus a minimized Persephone; Electron does not do that for web notifications. Filed as [US-2222](../US-2222-notification-click-focus/README.md); expected to be the same on Windows. |
| 25 | Theme follows the OS | **Not applicable.** No platform has an OS-follow mode; the idea is in `doc/tasks/backlog.md`. |
| 26 | Lock awareness and wording | **Pass after fix.** Electron emits `lock-screen` / `unlock-screen` only on Windows and macOS, so on GNOME `main.session.locked` stayed false while locked. `powerMonitor.getSystemIdleState()` does report `"locked"` there; the new `src/main/desktop-awareness-linux.ts` samples it every 2 s and `DesktopAwarenessService` uses it on Linux (Claude). Locking through GNOME's screen shield now sets `main.session.locked` and posts the `session-locked` / unlock events; their text does not say "Windows". |
| 27 | Placement not offered | **Pass after fix.** `node integration-test/run.mjs --with virtual-desktop --desktop 2` on Linux stops with "`--desktop`: virtual desktop placement is available only on Windows." (exit 2), and `--help` says placement is not available. The implementation had imported `src/shared/platform-features.ts` into `run.mjs`, which Node's type stripping cannot load (extensionless imports), breaking the runner on every platform; the runner now uses its existing `isWindows` import (Claude). |
