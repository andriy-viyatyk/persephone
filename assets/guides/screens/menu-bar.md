---
title: "Menu Bar"
audience: both
summary: "The Menu Bar categories, commands, Tools & Editors hub, and its file and folder actions."
screen: "menu-bar"
---

# Menu Bar

The Menu Bar opens from the Persephone glyph and slides over the page area. It combines the file
browser, tab switcher, and Settings entry point in one panel: categories are listed on the left,
and the selected category's contents appear on the right.

The backdrop is always in the DOM and is hidden when the Menu Bar is closed. Press `Esc` to close
it. `Ctrl+F` searches inside the selected folder category.

## Layout

## Menu Bar regions and controls

| Element | What it is for | Selector |
|---|---|---|
| Backdrop | The Menu Bar host; presence does not mean it is open | `[data-name="menu-bar"]` |
| Sliding panel | The visible Menu Bar panel | `[data-name="menu-bar-content"]` |
| Open File | Starts the file-opening flow (`Ctrl+O`) | `[data-name="menubar-open-file"]` |
| New Window | Opens another Persephone window (`Ctrl+Shift+N`) | `[data-name="menubar-new-window"]` |
| About | Opens the About guide browser while preserving its location | `[data-name="menubar-about"]` |
| Settings | Opens Settings as an ordinary page in a tab | `[data-name="menubar-settings"]` |
| User Guide | Opens About at the guide contents | `[data-name="menubar-user-guide"]` |
| Category list | Built-in categories and the user's pinned folders | `[data-name="menubar-folders"]` |
| Content pane | Shows the selected category | `[data-name="menubar-content"]` |
| Add Folder | Pins a folder to the category list | `[data-name="menubar-add-folder-button"]` |
| Width splitter | Resizes the Menu Bar | `[data-name="menubar-splitter"]` |

Right-clicking a pinned folder offers Open in New Tab, Show in File Explorer, Open Terminal here,
and Remove. The folder's label is not the same thing as its internal folder ID when using the
MCP `window.menuBar` API.

## Built-in categories

- **Open Tabs** lists every open page so the user can switch tabs even when the tab strip is crowded.
- **Recent Files** lists recently opened files and can be cleared from its context menu.
- **Tools & Editors** starts a new page from an editor and reaches registered Agent Tools. The
  Tools & Editors hub owns the `tools-hub-view` editor ID; the individual toolset screen is covered
  by [Agent Tools](../agent-tools.md).
- **Script Library** exposes the user's folder of reusable scripts. Its context menu can point the
  category at another folder, open it in Explorer, or unlink it.

Board Info and toolsets are destinations reached from the Menu Bar or its categories, not Menu Bar
screens. [Boards](../boards.md) owns the `board-info` editor ID, and [Agent Tools](../agent-tools.md)
owns `toolset-view`. Similarly, the [Mneme](../mneme.md) guide owns its two editor screens; the
Menu Bar is only their entry point.

The Menu Bar's **User Guide** item and `F1` open the in-app guide browser. `F1` selects a mapped
guide for the active editor and otherwise opens About at contents. The separate [About guide
browser](./index.md#about-guide-browser) explains the tree, filter, breadcrumbs, and Open in tab
controls.

