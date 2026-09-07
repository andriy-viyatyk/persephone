---
title: "Menu Bar"
audience: both
summary: "The Menu Bar categories, commands, Tools & Editors hub, and its file and folder actions."
screen: "menu-bar"
---

# Menu Bar

The Menu Bar opens from the Persephone glyph as a full-window overlay below the header. It combines
the file browser, tab switcher, and Settings entry point in one panel: categories are listed on the
left, and the selected category's contents appear on the right.

The backdrop is always in the DOM and is hidden when the Menu Bar is closed. Press `Esc` to close
it. `Ctrl+F` searches inside the selected folder category.

## Layout

```
+---------------------------------------------------------------------+
| [Menu Bar overlay]                                                  |  full-window overlay over the page area below the header, when open
+---------------------------------------------------------------------+
| [Open File] [New Window]   [About] [User Guide] [Guide ?] [Settings]|  top action row of the left category column; file actions at the left, app actions at the right end, Settings last
| [Folders]                                      | [selected content] |  left category column beside the right content pane
| [Add Folder]                                   | [splitter]         |  Add Folder at the bottom of the left column; splitter between the panes
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Menu Bar → `menu-bar`
- Menu Bar content → `menu-bar-content`
- Menu Bar categories → `menubar-categories`
- Menu Bar action row → `menubar-toolbar`
- Open File → `menubar-open-file`
- New Window → `menubar-new-window`
- About → `menubar-about`
- User Guide → `menubar-user-guide`
- Guide for this page → `menubar-guide-for-page`
- Settings → `menubar-settings`
- Folders → `menubar-folders`
- Content → `menubar-content`
- Add Folder region → `menubar-add-folder`
- Add Folder → `menubar-add-folder-button`
- Splitter → `menubar-splitter`

### When the Menu Bar is open

```
+---------------------------------------------------------------------+
| [Menu Bar overlay]                                                  |  full-window overlay over the page area below the header, when open
+---------------------------------------------------------------------+
| [Open File] [New Window]   [About] [User Guide] [Guide ?] [Settings]|  top action row of the left category column; file actions at the left, app actions at the right end, Settings last
| [Folders]                                      | [Content]          |  open Menu Bar panes with the category list at left
| [Add Folder]                                   | [selected content] |  Add Folder at the bottom of the category column and selected content on the right
+---------------------------------------------------------------------+
```

### When a folder category is selected

```
+---------------------------------------------------------------------+
| [Menu Bar overlay]                                                  |  full-window overlay over the page area below the header, when open
+---------------------------------------------------------------------+
| [Open File] [New Window]   [About] [User Guide] [Guide ?] [Settings]|  top action row of the left category column; file actions at the left, app actions at the right end, Settings last
| [Folders]                                      | [selected folder]  |  selected folder in the left category column
|                                                 | [dynamic content] |  selected category content in the right pane
| [Add Folder]                                   | [splitter]         |  Add Folder at the bottom of the left column; splitter between the panes
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Individual category rows, folder context-menu commands, and selected-category body controls — no entry: dynamic category/editor content; the stable list and content-pane anchors are the supported addresses.

Evidence: `MenuBarView.ts:89-143,177-205,224-245,455-467` and `MenuBar.css:2-29`.

## Menu Bar regions and controls

| Element | What it is for | Selector |
|---|---|---|
| Backdrop | The Menu Bar host; presence does not mean it is open | `[data-name="menu-bar"]` |
| Sliding panel | The visible Menu Bar panel | `[data-name="menu-bar-content"]` |
| Category column | The left column containing actions, folders, and Add Folder | `[data-name="menubar-categories"]` |
| Action row | The horizontal row of top-left and top-right commands | `[data-name="menubar-toolbar"]` |
| Open File | Starts the file-opening flow (`Ctrl+O`) | `[data-name="menubar-open-file"]` |
| New Window | Opens another Persephone window (`Ctrl+Shift+N`) | `[data-name="menubar-new-window"]` |
| About | Opens the About guide browser while preserving its location | `[data-name="menubar-about"]` |
| Settings | Opens Settings as an ordinary page in a tab | `[data-name="menubar-settings"]` |
| User Guide | Opens About at the guide contents | `[data-name="menubar-user-guide"]` |
| Guide for this page | Opens the active page's guide, or About at the guide contents when unmapped | `[data-name="menubar-guide-for-page"]` |
| Category list | Built-in categories and the user's pinned folders | `[data-name="menubar-folders"]` |
| Content pane | Shows the selected category | `[data-name="menubar-content"]` |
| Add Folder region | The bottom region of the category column | `[data-name="menubar-add-folder"]` |
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
