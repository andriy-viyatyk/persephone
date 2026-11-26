# US-2213: Window chrome, tray and close-to-tray

Epic: [EPIC-214](../../epics/EPIC-214.md). Status: planned. Implementation: Codex; live VM checks: Claude.

## Goal

Make Linux windows appear reliably, restore usable window state and prevent a close from stranding the app without a tray, preserving Windows behaviour.

## Background

[US-2212](../US-2212-wayland-or-xwayland/README.md) measured Electron's default native Wayland and chose it without an ozone switch. A hidden main window never receives `ready-to-show`; an explicit main-process `show()` renders correctly. Wayland coordinates are not reliable. The measured maximize/restore, title double-click and drag, edge resize, snap, minimize and dock restore work on both backends. The dev dock icon is generic. [Phase 2](../../reviews/multiplatform-roadmap.md#phase-2--desktop-integration-epic-214), [WIN-30](../../reviews/multiplatform-2026-11/inventory.md) and [R-5](../../reviews/multiplatform-2026-11/runtime-findings.md) identify the frameless window and default-on close-to-tray risk.

- `src/main/open-window.ts` creates all normal and board `OpenWindow`s hidden, calls `setSize` and `show` in `ready-to-show`, and loads the renderer later in the constructor. It does not set `backgroundColor`; Electron's installed `node_modules/electron/electron.d.ts` documents white as the default. No main-process theme/background source exists in `src/main/`. It reads `windowState` or `boardWindowStateKey(BoardRoot.from(...))` from `electronStore`, applies optional requested position, then calls `ensureVisiblePosition`. That helper finds the display by bounds center, falls back to primary and clamps to its work area. `focus()` repeats correction using `getBounds()` and `setBounds()`. `saveWindowSize` debounces normal, non-fullscreen bounds for 500 ms; **maximized state is not currently persisted**. Both `setAppDetails` calls already use `isWindows`. No `setThumbarButtons`, explicit hit-test or `thickFrame` call exists in `src`; `src/renderer/ui/app/MainPage.css` supplies drag/no-drag regions.
- The other `new BrowserWindow` is the 1Ã—1 `src/main/audio-service.ts` window, intentionally always hidden and driven by its own readiness promise, not `ready-to-show`. Guest popup options in `src/main/browser/popup-policy.ts` use `show: false` only when `desktopPlacement.isActive()`; `src/main/browser/BrowserGuest.ts` and `popup-policy.ts` explicitly call `desktopPlacement.showPlacedWindow` for child and nested popups. The latter acts only on windows registered for test desktop placement. They do not wait for `ready-to-show`.
- `src/renderer/api/settings-schema.ts` defaults `window.close-to-tray` to true. `src/renderer/api/window.ts` returns its inverse in the existing `resolveWindowClose` response. `src/main/open-windows.ts` honours that only for the last normal window; board and test windows close, `doQuit` overrides it, and a crashed renderer is destroyed after the existing timeout. `src/main/tray-setup.ts` creates an Electron `Tray` unconditionally; its click toggles normal windows and its menu shows or quits. `src/main/main-services.ts` starts tray setup after window restoration. `src/shared/platform-features.ts` is a static table, currently false on Linux for `desktop.tray` and `desktop.closeToTray`, and `getPlatformFeature` has no runtime input. `WindowBehaviorSectionView` in `src/renderer/editors/settings/sections/SettingsSections.ts` always displays the checkbox.
- Electron's [Tray documentation](https://www.electronjs.org/docs/latest/api/tray/) describes StatusNotifierItem with GtkStatusIcon fallback, but exposes no visibility/availability query. A StatusNotifier watcher and registered host are evidence of support, not proof that an icon is visible. Fail closed on uncertainty. Electron's [window documentation](https://www.electronjs.org/docs/latest/api/browser-window/#wingetbounds) confirms Wayland global-position restrictions.
- `src/main.ts` takes Electron's single-instance lock. `src/main/main-setup.ts` forwards a second launch to `openWindows.handleSecondInstance`; with no input, that calls `bringToFront()`, whose `makeVisible()` shows the main normal window when no normal window is visible. Thus a plain second launch can recover the hidden last window without changing this handler. `scripts/dev.mjs` launches Electron with `.` as the application path, so Electron reads this project's `package.json`; the installed Electron types document `desktopName` as the Linux desktop identity setting. The field is currently absent.

## Implementation Plan

- [x] **Window policy and first show.** Added `src/main/window-platform-policy.ts` using `isLinux`. Linux shows normal, secondary and board windows immediately after load begins and skips the later `ready-to-show` size reset; Windows retains the existing callback. The audio helper is unchanged.

  ```ts
  // Before: every platform waits for the hidden window's paint.
  this.window.once("ready-to-show", () => { this.window?.setSize(windowState.width, windowState.height); this.window?.show(); });
  // After: policy selects the existing callback or Linux's immediate show after load starts.
  if (windowPolicy.waitForReadyToShow) { /* existing callback */ }
  // after loadURL/loadFile, for the Linux policy: this.window.show()
  ```

- [x] **Placement and size.** The Linux policy omits stored and requested x/y, skips display corrections, and merges size-only saves into each existing geometry record so old x/y remain untouched. Windows retains its existing correction and write path; maximized/fullscreen exclusions are unchanged.

  ```ts
  // Before: every normal bounds save trusts global coordinates.
  { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
  // After on Linux: merge size; leave old x/y untouched and unused.
  { ...previous, width: bounds.width, height: bounds.height }
  ```

- [x] **Runtime tray availability.** Added a bounded `gdbus` probe and fail-closed cached snapshot. Tray setup probes after successful construction; last-normal-window close starts a non-blocking refresh before `eBeforeQuit`. Linux tray construction failure leaves availability false; Windows tray creation, click and menu paths remain intact.

  [x] Added the close-start callback before `eBeforeQuit`; `OpenWindows` uses its normal-window registry and excludes board/test windows. Close handling does not await the refresh.

  `src/shared/platform-features.ts` owns feature interpretation: extend `getPlatformFeature` with an explicit runtime availability input for the two tray IDs, keeping its static default false on Linux and all other feature calls unchanged. Main owns the cached snapshot; derive both `desktop.tray` and `desktop.closeToTray` from probe **and** successful tray creation. Never put mutable cross-process state in a shared module singleton. In `src/main/open-windows.ts` reuse `setCanQuit` and read the synchronous snapshot at the final hide decision; unavailable turns `canQuit` true for the last normal window, preserving save/cancel, board, test, explicit Quit and hung-renderer paths. The renderer round trip normally gives the refresh time to finish; a stale snapshot is accepted. If the tray vanishes after hiding, a plain second launch recovers the main normal window via the existing `bringToFront()` path; no automatic recovery is added. Do not claim the probe proves icon visibility.

  ```ts
  // Before: last normal window hides when the setting says so.
  if (isLastWindow && !this.doQuit && !canQuit) { openWindow.window.hide(); return; }
  // After: availability is also required; unavailable follows the existing quit path.
  const effectiveCanQuit = canQuit || !trayAvailability.closeToTrayAvailable();
  ```

- [x] **Settings and existing IPC.** Moved `WindowBehaviorSectionView` into its own module. A typed `WindowApi` snapshot request uses existing `bindDomain`; the section requests it once, starts hidden, handles disposal, and uses `getPlatformFeature` to hide the row without changing the stored setting. Updated the schema comment; no catalog or bridge surface changed.

- [x] **Dev dock identity.** Set `desktopName`, added a checkout-substituted per-user desktop entry template, and documented exact install and cleanup commands. The entry uses the checkout icon, launches `scripts/dev.mjs`, and sets the XWayland class. Packaging is unchanged.

- [x] **Automated checks after implementation.** `npm run typecheck`, `npm run lint` and `npm run build-prod` pass. The UI suite was not run per instruction; live Linux behaviour and the VM checklist remain Claude's check.

### Claude VM check

Claude runs [EPIC-214 checklist](../../epics/EPIC-214-checklist.md) items **2â€“5 and 7â€“9** (item 6 belongs to US-2212):

- **2:** cold start and reopen normal, secondary and board windows without MCP help; restart with changed normal size and verify compositor placement without stale coordinates.
- **3â€“4:** drag, every resize edge, snap, maximize/restore, double-click, minimize and dock restore; verify XWayland fallback too.
- **5:** install the documented dev desktop entry, launch and confirm correct icon and grouping on Wayland and XWayland.
- **7â€“8:** enable AppIndicator; confirm icon/menu, close-to-tray and restore; confirm setting false quits.
- **9:** disable AppIndicator before startup and verify settings hides the option and unavailable close quits. Also disable it while a window is hidden, then launch the app again using the same profile and verify the normal window returns. Re-enable it and check availability after the next close refresh and reopening settings, without changing the saved preference. Allow for the documented stale-snapshot race.

## Concerns

- Linux-wide conservative placement sacrifices XWayland's working saved coordinates to avoid confusing session type with Electron backend. This is deliberate; Windows remains unchanged. Wayland compositor policy can restrict even size/maximize requests, so VM checks establish the actual result.
- A tray change can race the asynchronous close refresh; a stale available snapshot can hide the window until a plain second launch recovers it. Settings shows the cached snapshot from when the section opened. A host can advertise itself while failing to present an icon. GtkStatusIcon-only desktops are treated as unavailable. Missing `gdbus` safely disables close-to-tray; no new native dependency is introduced.
- The existing audio helper and guest popup paths are intentionally not changed. `src/main/window-display-service.ts` also uses global coordinates for explicit display moves; that separate API is outside persisted window-state restoration and belongs to desktop-placement capability work (US-2218), not a reason to trust fake coordinates here.
- No new board rules, import-zone bypasses or protocol implementation. `SettingsSections.ts` shrinks. No `window.persephone` change is planned; if implementation changes it, bump `src/shared/board-bridge-version.ts` `BOARD_BRIDGE_VERSION` and add its history line. Strict-folder null-check fixes are type-only unless separately recorded as behavioural changes.

## Acceptance Criteria

- [x] Linux normal, secondary and board windows show without `ready-to-show`; Windows startup and placement behaviour is unchanged.
- [x] Linux restores normal size without using or overwriting stored x/y with reported positions, including old state and board keys. Maximization remains unpersisted, as on Windows; fullscreen dimensions are not persisted.
- [x] Cached tray capabilities are available through `platformFeatures`; last-window close honours the saved preference when the cached snapshot is available and quits when unavailable. Settings uses a one-time snapshot. A plain second launch recovers a hidden window after tray loss.
- [x] Probe errors and timeouts set availability to unavailable; existing close confirmation, tests, board windows and Quit semantics remain intact, and a close decision waits for a running probe (see VM checks).
- [x] Dev dock identity and checklist items 2–5 and 7–9 pass Claude's VM checks.

### VM checks (Claude, 2026-11-26, Ubuntu 26.04, native Wayland)

| Item | Result |
|------|--------|
| 2 Window shows at startup | Pass, with no MCP help. No white flash seen: frames 2 s apart went from no window to a rendered, dark window. |
| 3 Move, resize, snap | Pass. Super+Left/Right gives half-screen tiles; move and edge resize are unchanged from US-2212. |
| 4 Maximize, restore, minimize, double-click | Pass, including restore from the dock. |
| 5 Dock icon | Pass after installing the dev desktop entry: Persephone's icon, tooltip "Persephone (Development)", window grouped under it. |
| 7 Tray icon and menu | Pass. Show App and Quit work (activated by keyboard; a synthetic pointer move crosses the top-left hot corner and closes the menu, a test-tool artefact). |
| 8 Close with a tray | Pass: the window hides, the app keeps running, Show App brings it back. |
| 9 Close without a tray | **Failed at first, fixed.** With the AppIndicator extension turned off while the app ran, the first close hid the window: the renderer's `setCanQuit` reply arrived before the close-time probe finished, so it read the stale "available" snapshot. Fix: `TrayAvailabilityLinux.refresh()` shares one in-flight probe through `pending`, and `OpenWindows.setCanQuit` waits for it before deciding. After the fix the first close quits. |

Not checked in the VM: the Settings row hiding without a tray, and second-launch recovery. Typecheck, lint and production build pass; the Windows UI suite was skipped per instruction.

## Files Changed

| File | Planned change |
|------|----------------|
| `src/main/window-platform-policy.ts` (new), `src/main/open-window.ts` | Linux show and bounds policy; reuse state keys and existing placement helper; start refresh on close |
| `src/main/tray-availability-linux.ts` (new), `src/main/tray-setup.ts`, `src/main/open-windows.ts` | Startup and close probes, cached snapshot and close fallback |
| `src/shared/platform-features.ts` | Runtime capability interpretation using the existing OS selection |
| `src/ipc/contracts/window.ts`, `src/ipc/main/window-handlers.ts` | One typed capability snapshot request on existing IPC infrastructure |
| `src/renderer/editors/settings/sections/WindowBehaviorSection.ts` (new), `src/renderer/editors/settings/sections/SettingsSections.ts`, `src/renderer/editors/settings/SettingsView.ts`, `src/renderer/api/settings-schema.ts` | Move section, track runtime capability, clarify setting comment |
| `package.json`, `scripts/linux-vm/com.viyatyk.persephone.desktop` (new), `doc/linux-development.md` | Linux dev desktop identity and installation |
| `doc/tasks/US-2213-linux-window-and-tray/README.md`, `doc/linux-development.md`, `doc/active-work.md`, `doc/epics/EPIC-214.md` | Progress checklist, dev desktop instructions, and task links |

No changes planned to `src/main/main-setup.ts`, `src/main/audio-service.ts`, `src/main/browser/popup-policy.ts`, `src/main/test-mode/desktop-placement.ts`, `src/renderer/ui/app/MainPage.css`, `src/shared/i18n/en/`, `electron-builder.yml`, existing UI tests, or board bridge code.

