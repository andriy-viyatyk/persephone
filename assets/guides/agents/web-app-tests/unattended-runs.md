---
title: "Run web-app tests unattended"
audience: "agent"
summary: "Keep tests and Persephone agents working when the screen is locked, a window is on another virtual desktop, or it is minimized."
---

# Unattended runs

Persephone can keep web-app tests drawing when nobody is watching the test window. This covers a
locked desktop session, a window on another Windows virtual desktop, and a minimized window. Linux
workspace placement and visibility are not detected, and desktop-bound operations remain unavailable
while locked.

## What Chromium changes when a window goes unseen

A window that is already open when the desktop session locks or, on Windows, the user switches virtual desktops
can be marked hidden by Chromium. A minimized window is hidden too. Without unseen mode, animation
frames stop, timers can fall to about one second, and screenshots may be stale. Chromium sometimes
recovers on its own after roughly 14–48 seconds, but that recovery is inconsistent and should not
be relied on.

While the session is locked, no mode can provide the OS clipboard, native file dialogs, real OS
focus, or global hotkeys. Tests that need those operations should declare
`requires: ["desktop"]`; the runner skips them with a reason when the desktop is unavailable.

## Unseen mode

Unseen mode disables background throttling for eligible web contents. It starts enabled in
instances launched by the test runner. An `--attach` invocation enables it for that run and restores
the exact previous value after window cleanup, including caught test or setup failures. A hard
termination cannot run that restoration. The setting is not persisted across Persephone restarts.
Rendering in the background uses more power.

An agent working in the user's own Persephone can inspect and control the process-wide setting:

```text
call main.unseenMode.enabled
call main.unseenMode.enable args []
call main.unseenMode.disable args []
```

In MCP calls, `main.unseenMode.enabled` returns the current boolean. `enable()` and `disable()` are
temporary toggles; set the value back to its original state when finished.

With unseen mode on, embedded browser pages report `document.visibilityState === "visible"`,
including the top document of a minimized window. The preload shim applies the same behavior to
iframes and suppresses hidden `visibilitychange` events; disabling restores real visibility.
Standalone pop-up windows retain their real visibility. A new subframe can briefly read the mode
value from before a recent toggle in its first script, until the asynchronous frame update arrives.
With the mode off, minimized browser pages are hidden. Unseen mode keeps their frames, timers and
screenshots current.

## Lock and desktop awareness

The MCP event block can include a `session-locked` or `session-unlocked` message with the current
unseen-mode value and the available workarounds or limits. The event appears on the next call
answered by a renderer. Calls on `main.*` and `windows[i].*` paths are answered by the main process
and do not include that event block; use a page or app renderer call to receive it.

Read `main.session.locked` for the current process-wide lock state. Lock state and event delivery
depend on the desktop session. Read `windows[i].desktopVisible` for a particular window: it is false
when the session is locked, the window is minimized or hidden, or (on Windows) it is on another
virtual desktop. Linux workspace visibility is not detected.

Use `{ requires: ["desktop"] }` for a test that performs an OS clipboard operation, opens a native
file dialog, or depends on real desktop focus/input. The host evaluates this requirement
immediately before each tagged test, not once for a whole file or run. If a lock happens during a
test, that test is not interrupted; the next tagged test is checked again. For example:

```js
test("copies a value to the Windows clipboard", async (ctx) => {
  // Exercise an operation that uses the real OS clipboard.
}, { requires: ["desktop"] });
```

Its exact skip reasons are:

- `needs a visible desktop (screen locked)`
- `needs a visible desktop (test window hidden, minimized, or on another virtual desktop)`

The first reason is used when `main.session.locked` is true. Otherwise, a false
`windows[i].desktopVisible` produces the second reason.

## Choose a virtual desktop

`--desktop <n|name>` is Windows-only. It opens all windows in an owned run on an existing Windows virtual desktop. A
number is 1-based; a name must match exactly, ignoring case. Unknown desktops fail before the run
starts and report the available numbered/name list, with a reminder to create one using
**Win+Ctrl+D**. The option is not supported with `--attach`.

On Windows, Persephone moves its windows without activating them, so the user's current desktop does not switch. Linux does not support `--desktop` placement.
The target desktop must already exist; create one with **Win+Ctrl+D**. On Windows 11 a native file
dialog opens on the same desktop as its test window, so it does not interrupt the user, but nobody
there can answer it. Keep tests that need a native dialog tagged `requires: ["desktop"]`.

## Recipes

### Lock the screen during a suite

Start an owned run and let it initialize, then press **Win+L**. Tests continue rendering with unseen
mode on. Tests marked `requires: ["desktop"]` are skipped while the session is locked; clipboard,
native-dialog, focus and hotkey work cannot be made unattended by this setting.

### Run on desktop 2 while you keep working

Create a second desktop with **Win+Ctrl+D**, then run:

```powershell
persephone-test.exe <tests> --desktop 2
```

The runner opens its windows on desktop 2 and leaves your current desktop alone.

### Continue after a lock event in the user's window

When a renderer-answered call reports `session-locked`, read `main.session.locked` if you need the
current state. Check `main.unseenMode.enabled`; if it is off, call `main.unseenMode.enable` with
`args: []`. Continue page and DOM work, and defer clipboard,
native-dialog, real-focus and global-hotkey work until unlock. `windows[i].desktopVisible` is false
while locked even if unseen mode keeps the window drawing.
