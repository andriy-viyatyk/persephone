---
title: "Agent events — learn what changed"
audience: agent
summary: "Read the event history for changes and user actions since the agent last looked."
---

# Agent events — learn what changed

The MCP `call` result can report what changed in the renderer window since this MCP session last
looked. The block shows up to the newest three unseen events. If more unseen events exist, it adds a
`+N earlier events; read events.recent()` line. The cursor is per MCP session and per renderer
window, so one session does not consume another session's events.

For the remote model behind a shape-change event, see [Browser automation](./browser.md) or
[Boards](./boards/index.md).

## Read and wait

Use `events.recent()` for the newest retained events, newest first. Use `events.since(seq)` for
retained events newer than a sequence number. `events.count` reports the number currently held in
the 200-entry window ring.

Use `events.wait()` when the next change matters:

```js
const result = await events.wait();
// If result.pending is true, call events.wait() again.
```

The default wait is 50 seconds. An explicit `timeoutMs` is capped at 110 seconds. At the bound,
the result is `{ pending: true }` with an instruction to call `events.wait()` again.

## Walking the user through the UI

`ui.guide.step(target, message, options?)` is `events.wait()` with a highlight in front of it. It
draws a card on one control with **Skip** and **Next**, waits for the user, and returns
`{ pressed: "Next", target }`. Call it once per control. The `target` is a curated shell name, a
CSS selector, or a bare `data-name` — read the owning node's `elements` for a control's selector.
When it returns `pending`, call it again for the same target: the card is replaced, not stacked,
and a press that already arrived is returned immediately. Call `ui.guide.end()` when the
walkthrough is over.

## What is recorded

The log records board refreshes and reloads, navigation in a browser tab that has registered a
model, answered dialogs, guide-card button presses, browser pop-ups opening and closing
(`popup-opened` / `popup-closed`, for pages you may access), and relevant active-page changes. When a page
you have addressed becomes hidden, a `page-activated` event tells you which page is active now —
re-activate yours before reading anything geometry-dependent, because a hidden page has no layout
box. Switches you asked for yourself are not reported, and neither is moving between two pages
grouped side by side, since both stay on screen. It
also records `notify(text)` from a trusted board or a participating page. Remote text is marked as
board-written or page-written and shown with an attribution suffix. Text written by Persephone has
no remote attribution. Error and warning toast notifications are also added to the feed, so an
agent can notice failures without first asking for the alert list; informational and success toasts
are not added.

Desktop session transitions are recorded once in each renderer window's event history when the
desktop session delivers lock events. A lock
event reports that hidden-page animation frames stop and timers slow without unseen mode, lists OS
operations that remain unavailable even with unseen mode, and gives the current mode value plus
`main.unseenMode.enable` with an empty argument array. An unlock event reports the current unlocked
state and mode; minimized or other-desktop windows may still be unusable. Linux workspace visibility
is not detected. The initial idle-state read is not a guarantee that every session reports lock
state. The live process state is `main.session.locked`.

The event text is (with the current boolean substituted):

```text
Session locked; without unseen mode, animation frames stop (and anything waiting for them) and timers slow to about 1 s. OS clipboard, native file dialogs, real OS focus, and global hotkeys remain unavailable in every mode. main.unseenMode.enabled is {true|false}; call main.unseenMode.enable with args: [] to keep frames and timers running.
Session unlocked; main.session.locked is false, desktopVisible still depends on the window's minimized/virtual-desktop state, and Linux workspace visibility is not detected. main.unseenMode.enabled remains {true|false}.
```

The mode placeholder is replaced with the value captured when the transition is published.

When an event says that a shape changed, read the named `pages["<id>"].editor.app` path again
before using that model. A guide-button event tells you which control the user skipped or advanced.
Dialog events do not include passwords, input text, or other dialog values.
