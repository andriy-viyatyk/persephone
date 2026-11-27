---
title: "Linux desktop integration"
audience: user
summary: "Use Persephone with Linux browsers, file managers, notifications, and the system tray."
---

# Linux desktop integration

## Default browser

Open **Settings → Browser → Default Browser** to see whether Persephone is currently selected for
web links. Choose **Set as Default Browser** to register Persephone for HTTP, HTTPS, and HTML links.
If you later choose another browser in desktop settings, Persephone reports that choice and leaves
it in place. **Unregister** removes Persephone's handler without changing another browser's
selection. In a named application profile, manage this from the usual Persephone profile instead.

## Board launchers

Create a Linux application launcher from a board's context menu in **Boards**, **Tools & Editors**,
or its open page tab. The Save dialog starts in your user applications folder; choose another
location, such as **Desktop**, if you prefer. Launchers use the board's icon when available and
open the board in a dedicated Persephone window. For development launchers and other details, see
[Boards](./boards/getting-started.md#run-a-board-in-its-own-window).

## File clipboard and drag

In File Explorer, use **Cut**, **Copy**, and **Paste** to move or copy files between Persephone and
your Linux file manager, such as GNOME Files. You can also drag files from Persephone to the file
manager or Linux desktop, and drag files from those locations into Persephone. See [File Explorer
and Panels](./tabs-and-navigation/file-explorer-and-panels.md#file-explorer-panel) for selection,
multi-file, and overwrite behavior.

Clipboard history is available on Windows and is optional. Persephone does not offer it on Linux;
GNOME Wayland has no supported way for apps to watch the clipboard. Windows history does not provide
clipboard exclusion metadata. See the [Clipboard panel](./screens/sidebar.md#clipboard). File copy,
cut, and paste remain available on Linux.

## Notifications

When you click a website notification, Persephone brings its window forward and selects the browser
page and inner tab that created it. The website's own notification click handler still runs.

## Tray and closing the window

When the Linux desktop provides a tray host, Persephone shows a tray icon. Closing the last normal
window hides the app; use the tray menu to show it again or quit. If no tray host is available,
closing the last window quits Persephone even when **Close to tray** is enabled, so the app cannot
remain running with no way to reopen it.
