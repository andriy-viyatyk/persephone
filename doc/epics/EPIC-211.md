# EPIC-211: Tests in an unseen window (locked screen, other virtual desktop)

## Status

**Status:** Completed 2026-11-24
**Created:** 2026-11-24

## Overview

Persephone's test runs, and agents using the user's own Persephone, stall when nobody can see the
window: the user locks the screen, or the window sits on another Windows virtual desktop. The POC
in [US-2184](../tasks/US-2184-unseen-window-test-runs/README.md) measured why and proved the fixes.
This epic builds them.

POC facts this epic relies on (details and measurements in US-2184):

- **The trigger is the transition, not the state.** A window that is open when the screen locks, or
  when the user switches desktops, is marked hidden by Chromium: `visibilityState: "hidden"`, no
  `requestAnimationFrame`, timers throttled to ~1 s. It recovers by itself after 14–48 s, but not
  reliably. The user's long-open main window stayed hidden for minutes. A window created while the
  screen is already locked is not affected.
- **One runtime setting fixes both cases.** `webContents.setBackgroundThrottling(false)` on every web
  contents of the instance, set at runtime with no restart, kept a window open before the lock
  `visible` with normal frames and timers, on a locked screen and on desktop 2. The four
  launch-time Chromium switches (`--disable-features=CalculateNativeWinOcclusion` and the three
  `--disable-*backgrounding*/throttling` switches) do the same, but only for an instance started
  with them.
- **Screenshots keep working** (CDP capture, `capturePage`), even while the window is hidden.
- **Some things cannot work while locked, in any mode:** the OS clipboard, native file dialogs, real
  OS focus, global hotkeys. The locked full suite (code unchanged) had 14 failures: 8 use the OS
  clipboard (confirmed by a locked rerun). The other 6 are not yet explained. These are:
  - 3 in `browser/popups` (clear, check and drag in a pop-up window);
  - 1 in `capabilities/terminal` (a menubar click);
  - 1 stale assertion in `boards/bridge` (it expects bridge 1.62.0; the app reports 1.63.0);
  - 1 one-off in `editors/links`.

  US-2194 compares them with an unlocked run.
- **Lock detection:** `powerMonitor` `lock-screen` / `unlock-screen` events and
  `powerMonitor.getSystemIdleState()` returning `"locked"`.
- **Virtual desktops:** `IVirtualDesktopManager.IsWindowOnCurrentVirtualDesktop` works for any
  window from any process. `MoveWindowToDesktop` works only on the caller's own windows
  (`E_ACCESSDENIED` otherwise), so placement must run inside Persephone's main process. Through the
  `koffi` FFI in Electron 44, the following placed windows on desktop 2:
  1. `new BrowserWindow({ show: false })`;
  2. move to the target desktop;
  3. `showInactive()`.

  The windows were cloaked, never focused and drawing normally. The user's desktop did not change
  and the user saw no flash. Activating a window on another desktop switches the user to that
  desktop, so such a window must never be focused.

## Goals

- Agents and test runs keep working, at full speed, on a locked screen, on another desktop or in a
  **minimized window** (added 2026-11-24 at the user's request).
  - With unseen mode on, a minimized window already gets frames, normal timers and current
    screenshots; with it off, screenshots are stale.
  - The remaining gap is the web page's `visibilityState`, which stays `hidden` while its window is
    minimized (US-2197).
- An agent knows when the screen is locked, what stops working, and how to keep going.
- Tests that need the real desktop report **skipped** with a reason, not failed.
- A test run can open its windows directly on a chosen virtual desktop without disturbing the user.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-2184](../tasks/US-2184-unseen-window-test-runs/README.md) | Investigation + POC | Done |
| [US-2192](../tasks/US-2192-unseen-test-mode/README.md) | Unseen test mode: keep every window drawing while hidden (runtime switch, automatic for owned runs) | Done |
| [US-2193](../tasks/US-2193-lock-awareness/README.md) | Lock awareness: agent notification on lock/unlock and a `desktopVisible` value | Done |
| [US-2194](../tasks/US-2194-visible-desktop-requirement/README.md) | "Needs a visible desktop" test requirement; tag the clipboard and other OS-dependent tests | Done |
| [US-2195](../tasks/US-2195-test-window-virtual-desktop/README.md) | `--desktop <n\|name>`: open the test run's windows on a chosen virtual desktop | Done |
| [US-2197](../tasks/US-2197-minimized-page-visibility/README.md) | Minimized windows: web pages report `visible` while unseen mode is on | Done |
| [US-2196](../tasks/US-2196-unattended-runs-guide/README.md) | Guides: unattended runs (locked screen, second desktop, minimized window) | Done |

Order: US-2192 first (everything builds on it), then US-2193 and US-2194, then US-2195, then US-2196
last so the guides describe the final behaviour.

## Epic-level decisions

1. **One mechanism if it is enough.** Prefer the runtime setting (`setBackgroundThrottling(false)`
   on all current and future web contents) for owned runs, `--attach` runs and the user's window
   alike. Keep the launch switches only if US-2192's investigation finds a case the runtime setting
   misses. The POC files are throwaway and are removed or replaced by US-2192:
   - `src/main/test-mode/unseen-window.ts` and its call in `src/main/main-setup.ts`;
   - `integration-test/tests/zz-probe/` and `integration-test/tests/zz-probe-lock/`.
2. **Unseen mode is off by default for the user's instance.** It costs power when the window is
   really hidden. It is on automatically in instances the test runner starts. Elsewhere an agent or
   the runner turns it on explicitly (`--attach` runs restore the previous value at the end). It is
   not persisted; a restart or an agent call turns it off. There is no UI toggle or indicator in v1.
3. **Window-visibility knowledge lives in the main process** (one module), not at call sites; the
   renderer and test host read it through the object model.
4. **Never focus a window placed on another desktop** (US-2195). The rule is enforced in the one
   window-placement module, not by each caller.
5. **No new protocol code**; the lock notification uses the existing MCP event channel ("Events
   since your last call").

## Notes

- The user's customer project is never named in these documents.
- 2026-11-24: implementation waits for the user's go-ahead; the user's Persephone must not restart
  while they work. Planning (documents only) may proceed.
