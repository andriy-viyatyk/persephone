# US-2139: Board hotkeys

**Status:** Recorded idea (2026-11-21). Not investigated and not planned in detail. Before
implementation this document needs the full investigation and plan required by
[agents-common.md](../../agents-common.md) ("Creating a new task").

## Goal

A board can declare an action with a default hotkey. Persephone owns a setting where the user can
change or disable that hotkey. Pressing the hotkey runs the board's action, even when the board is
not open in Persephone.

## Why

Came out of a review of Persephone as a platform for mini apps (2026-11-21). Several board ideas
need a way to be triggered without first finding and opening the board: push-to-talk for an
interpreter, quick capture into a notes board, start/stop for a timer or recorder.

## Design notes (proposals, not decisions)

- **Declare in the manifest.** A hotkey must work with no board page open, so the declaration
  belongs in `board-manifest.json`, normalized in `src/shared/board/`, and contributed only by
  trusted boards and enabled bundled boards. It disappears on untrust, disable or uninstall.
- **Reuse the capability route for dispatch.** A hotkey entry could name one of the board's own
  capability methods: a `call` method reaches the board service with no page open; an `open`
  method opens or reuses the board page and delivers the action as an intent. This adds no new
  cross-process protocol (refactoring guardrail 1).
- **Persephone owns the binding.** The manifest gives only the default. The user's rebind or
  disable is stored in app settings and survives board updates.
- **Conflicts are visible.** A board never silently takes over a built-in shortcut, the Voice
  Typing shortcut or another board's hotkey. The user sees the conflict and can fix it.

## Notes from a stopped investigation (Codex, 2026-11-21; not re-verified)

An investigation run was started and stopped early. It recorded these points; check them again
when the task is planned.

- A main-process platform invocation needs an owner renderer even for a `call` method:
  `CapabilityRouter.createInvocationContext()` rejects an ownerless platform caller.
  `capabilityClientForWindow()` supplies the platform identity and lifetime. So "no page open"
  still needs some window to own the call.
- `BoardCapabilityDispatcher` opens or reuses a page in the caller's window and does not route
  across windows.
- A simple board that only wants "open me and do X" would declare a capability and settle an
  intent; it does not need a service. The Demo board already does this with `demo.greet`.
- `src/shared/voice-typing-shortcut.ts` normalizes chords and reserves some app keys, but it also
  carries right-Ctrl tap handling and does not cover every shortcut in `KeyboardService` and
  `BrowserShortcutTable`. The settings `ShortcutField` control is coupled to the two voice
  settings.
- `appSettings.json` is loaded by the renderer (`settings.ts`); main does not load it. A
  main-process hotkey registry would need the bindings delivered to it.
- `stableBoardIdentity()` uses manifest author/name and `boardDataIdFromRoot()` uses a bundled id
  or the folder name. Neither is guaranteed unique, which matters for the settings key.

## Open questions

1. **Scope.** Only while a Persephone window has focus, or also OS-global (works while Persephone
   is unfocused or in the tray)? Global needs Electron `globalShortcut`, which the app does not use
   today.
2. **Consent.** Do hotkeys need a permission flag or a line in the Trust board dialog, especially
   global ones? Does adding a hotkey to a trusted board show "Board permissions changed"?
3. **Where the action lands.** Which window opens the board when no page is open, and what
   happens when the board is already open in a board-mode window?
4. **Settings UI.** Where the user sees and edits board hotkeys: Settings, Board Info, or both.
5. **Board-side API.** Whether a board can read its current binding to show it in its own UI
   (a `window.persephone` change, which means a `BOARD_BRIDGE_VERSION` bump).
6. **Limits.** Number of hotkeys per board, accepted key combinations, keys the app keeps.

## Acceptance criteria (draft)

- A trusted board with a declared hotkey runs its action when the key is pressed, with and
  without a page of that board open.
- The user can rebind and disable each board hotkey in Persephone, and the choice survives a
  board update.
- A conflict with a built-in shortcut or another board is shown to the user and never resolved
  silently in the board's favor.
- Untrusting or removing the board removes its hotkeys immediately.
