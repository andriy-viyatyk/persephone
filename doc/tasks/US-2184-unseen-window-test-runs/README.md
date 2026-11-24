# US-2184: Test runs in an unseen window (locked screen, other virtual desktop) — investigation + POC

**Status:** Planned — not started. Investigation and proof of concept first; the implementation plan
is written from the POC results.

## Goal

Let `persephone-test.exe` runs (Persephone's own UI suite and users' web-app tests) work when the
test window cannot be seen: the screen is locked, or the window sits on another Windows virtual
desktop so it does not disturb the user's other work. Tests that genuinely need a visible Windows
desktop can tell and report **skipped** instead of failing. The agent can also ask the runner to
open the test window directly on a chosen virtual desktop, for example "test on the second desktop".

**In scope:**
- a locked screen and a second virtual desktop on the user's own machine;
- starting the test window on a chosen, existing virtual desktop.
**Test mode only in owned runs:** the switches apply only to a Persephone process the test runner
launches. The user's main Persephone and `--attach` runs are unchanged in v1.
**Out of scope (for now):** VMs, disconnected or minimized remote-desktop sessions, CI agents running
as a Windows service (no desktop), offscreen rendering.

## Background — why it fails today

Persephone's screenshots come from what Chromium draws (`capturePage`, CDP page screenshots), not
from the monitor, so the window does not need to be on screen. It only needs Chromium to keep
drawing it. Today Chromium stops:

- **Visibility (occlusion) tracking.** On Windows, Chromium calculates whether each window can be
  seen. A locked session or a window on another virtual desktop (cloaked by Windows) counts as
  hidden, so the page is marked hidden.
- **Hidden pages produce no frames.** A screenshot then waits for a frame that never comes (timeout,
  blank or stale image). `requestAnimationFrame` stops, so code waiting for the next frame stalls.
- **Background throttling.** Timers drop to about once a second, and further after about 5 minutes.
- **Focus.** A window on another virtual desktop never has real OS focus (`document.hasFocus()`,
  focus/blur events, `:focus-visible`).

DOM reads, scripts and automation input sent through CDP keep working, so DOM-based assertions
usually pass, and frame- or pixel-based steps fail.

Only the hidden audio window sets `backgroundThrottling: false`
(`src/main/audio-service.ts`). Main windows use Chromium's defaults.

Related runner facts ([integration-tests.md](../../standards/integration-tests.md)):

- An owned run starts its **own** Persephone process, so process-wide Chromium switches can be set
  only for test runs.
- `--attach` joins the user's running process, whose switches are fixed at startup.
- Tests already declare `requires` tags, for example `launch`, which is skipped with `--attach`.
  This is the natural place for a "needs a visible desktop" requirement.

## Investigation / POC plan

1. **Reproduce.** Run a handful of UI-suite tests, at least one with screenshots and one with
   animation or virtual scroll, on another virtual desktop and with the screen locked. Record what
   fails and how (timeout, blank image, stall).
2. **Test-mode switches for owned runs**, applied only when the runner launches the instance:
   - Process-wide:
     - `--disable-features=CalculateNativeWinOcclusion`;
     - `--disable-renderer-backgrounding`;
     - `--disable-background-timer-throttling`;
     - `--disable-backgrounding-occluded-windows`.
   - Per page: `backgroundThrottling: false` for test windows and their `<webview>` / board frames.
   - Focus emulation through CDP (`Emulation.setFocusEmulationEnabled`) for automated pages.
   - `powerSaveBlocker` (`prevent-app-suspension`) for the run's duration.
   - Screenshots of a still-hidden page: try `capturePage(rect, { stayHidden: true })`.
3. **Locked screen frame timing.** With Windows not drawing the desktop, check whether Chromium still
   produces frames at a normal rate. If not, try a frame clock that does not depend on the display,
   for example `--disable-gpu-vsync` or `--disable-frame-rate-limit`, and measure.
4. **`--attach` is out of scope for v1 (decided).** Test mode is turned on only for an instance the
   runner launches as its own process. The user's main Persephone and `--attach` runs keep
   Chromium's defaults. Minimized windows always pause, so a test window must be moved to another
   desktop, not minimized.
5. **Desktop-visibility flag.**
   - Expose to tests whether the window is actually visible to the user. The working name is
     `desktopVisible`; it is false when the session is locked or the window is on another virtual
     desktop.
   - Find how to detect it:
     - session lock: `powerMonitor` `lock-screen`/`unlock-screen`, or a WTS session query;
     - virtual desktop: the window's `DWMWA_CLOAKED` attribute or `IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop`.
   - Proposed use:
     - a `requires: ["desktop"]` tag the host checks, skipping with a clear reason such as "skipped:
       desktop not visible (screen locked or window on another virtual desktop)";
     - plus a runtime value for tests that decide mid-test.
   - The skip must read as skipped, not failed, so a test agent does not chase it.
6. **Classify the UI suite.** List the tests that need the real OS:
   - Windows-level input and drag-and-drop with Explorer;
   - native file dialogs;
   - global hotkeys, tray, notifications;
   - foreground/focus behaviour;
   - multi-monitor and DPI.

   Tag those with the new requirement.
7. **Start on a chosen virtual desktop.**
   - **Runner option:** `persephone-test.exe ... --desktop <n | name>`, for example `--desktop 2` or
     `--desktop "Testing"`. Owned runs only, like test mode.
   - **What Windows offers.** The documented `IVirtualDesktopManager` (shobjidl.h) has three calls:
     - `IsWindowOnCurrentVirtualDesktop` (also feeds `desktopVisible`);
     - `GetWindowDesktopId`;
     - `MoveWindowToDesktop`, which works only for the caller's own windows. That is enough here,
       because Persephone moves its own windows.
   - **Finding the desktop.** The documented API cannot list desktops, so map number or name to a
     desktop ID from the registry. Read-only, undocumented but stable:
     - `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops\VirtualDesktopIDs`,
       the desktop IDs in order (16-byte GUIDs, concatenated);
     - `...\VirtualDesktops\Desktops\{GUID}\Name`, user-given names.

     Verify both on the current Windows 11 build.
   - **Do not use the internal `IVirtualDesktopManagerInternal` interface.** It can create and switch
     desktops, but its IDs change between Windows builds.
   - **The desktop must exist.** Persephone does not create one. If it is missing, fail the run at
     once with a clear message: "virtual desktop 2 not found; create one with Win+Ctrl+D".
   - **No flash.** Create the test window hidden, move it, then show it. Verify in the POC that a
     never-shown window can be moved. If not, show it off-screen, move it, then position it.
   - **Follow-up windows.** Windows opens new windows on the current desktop. The test instance must
     move every new window it opens (pop-ups, extra Persephone windows) to the test desktop as it
     is created. Native file dialogs cannot be moved; record what happens to them.
   - **Native access.** Electron has no virtual-desktop API, but `BrowserWindow.getNativeWindowHandle()`
     gives the window handle. Choose between:
     - a small helper program, like the existing Rust `launcher/` and `snip-tool/`;
     - an FFI library, if one is already a dependency; check `package.json`.

     Keep it in one main-process module, the same module as visibility detection.
8. **Write up the results here and the implementation plan**, naming the owner of each rule. The test
   host and controller own launch switches and the requirement check. Window-visibility detection
   belongs in the main process, not at call sites.

## Concerns / open questions

- The occlusion switch is process-wide. That is why v1 limits test mode to owned test instances.
  Under `--attach`, a test that needs a visible desktop still works through the `desktop` skip rule,
  because the flag is detected in every instance.
- Native file dialogs opened while the screen is locked may block the run. Detect and fail fast, or
  tag those tests?
- GPU behaviour under the lock screen may differ by driver; WebGL and DRM video may not draw.
- Does a page's `document.visibilityState` stay `visible` with the switches on? Web apps under test
  may pause work when hidden.
- The virtual-desktop registry layout is undocumented. If a Windows update changes it, `--desktop`
  must fail with a clear message, never place the window on the wrong desktop silently.
- Should the virtual-desktop helper be a separate executable or in-process FFI? Decide from the POC,
  including antivirus and signing implications of a new `.exe`.
- The users' web-app test guide (`assets/guides/agents/web-app-tests/`) needs a line on running
  unattended once this works.

## Likely files (confirm during the POC)

| File | Likely change |
|---|---|
| `src/main/test-mode/arguments.ts`, `instance-options.ts` | Pass test-mode Chromium switches only to owned test instances |
| `src/main/test-mode/controller.ts` | Launch the instance with those switches; keep the machine awake for the run |
| Main-process window creation for test windows | `backgroundThrottling: false`; a new main-process module for desktop-visibility detection (session lock, cloaked window) |
| `src/test-host/file-hooks.ts` | Skip rule for a new `desktop` requirement, next to the existing `launch` rule (line 49–50) |
| `src/test-host/context-operations.ts` | Expose the runtime `desktopVisible` value to tests |
| `src/main/test-mode/arguments.ts`, `controller.ts` | New `--desktop <n \| name>` option; resolve it before the window is shown |
| New native helper (Rust crate next to `launcher/`, or an FFI module) | Map desktop number/name → ID, move windows, query current desktop |
| `doc/standards/integration-tests.md`, `assets/guides/agents/web-app-tests/` | Document the requirement tag and unattended runs |

Files expected to need no changes: the renderer automation layer (`src/renderer/automation/`) and
the MCP handlers. Screenshots already go through Chromium capture, not the screen.

## Acceptance criteria (POC)

- [ ] An owned UI-suite run on a second virtual desktop passes the same tests as a visible run
      (minus tests that need the real OS).
- [ ] The same is true with the screen locked for the whole run.
- [ ] Screenshots taken while hidden are current, not blank or stale.
- [ ] Tests that need a visible desktop report **skipped** with a clear reason when it is not
      visible, and run normally when it is.
- [ ] `--desktop 2` (and by name) opens the test window on that desktop without a flash on the
      current one. Pop-up and extra windows opened by the test land there too.
- [ ] `--desktop` naming a missing desktop fails at once with a clear message.
- [ ] Findings and a follow-up implementation plan are recorded in this document.
