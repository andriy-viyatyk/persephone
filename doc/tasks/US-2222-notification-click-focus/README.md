# US-2222: Clicking a website notification brings Persephone forward

Epic: [EPIC-214](../../epics/EPIC-214.md). Status: Planned (idea; not yet investigated).

## Goal

Clicking a desktop notification shown by a website (or board) in a Persephone browser tab restores and focuses the
Persephone window and shows that tab, as Chrome does.

## Background

Found in the US-2218 VM check (Ubuntu 26.04, GNOME Wayland, 2026-11-26): a `localhost` page with notification
permission granted shows its notification in GNOME's list under "Persephone (Development)" with the app icon and a
dock badge, and clicking it fires the page's `onclick`, but a minimized Persephone stays minimized and the tab is not
shown. Electron does not focus the window for web notification clicks; this is expected to be the same on Windows
(not yet checked there).

Candidate owner: the webview preload (`src/preload-webview/`) wraps `Notification` click delivery and asks the host
page to show itself through an existing channel; or a main-process hook if Electron exposes one. To be decided in the
plan; must not add protocol code (refactoring guardrail 1) and must keep the site permission policy unchanged.

## Acceptance criteria

- With Persephone minimized or behind another window, clicking a site notification restores and focuses the window
  and activates the tab that raised it, on Windows and GNOME.
- A page's own `onclick` handler still runs; permission decisions are unchanged.
