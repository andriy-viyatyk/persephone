---
title: "Page Area and Sidebar"
audience: both
summary: "The page area and the shared sidebar frame for Explorer, Search, Boards, and other panels."
screen: "sidebar"
---

# Page Area and Sidebar

Everything below the header is the page area. The active page is rendered by its editor, and its
page-owned secondary panels can appear in a sidebar on the left. Switching tabs can therefore
change the sidebar: panels belong to a page, not to the application window.

The same frame hosts Explorer, Search, Boards, and the Clipboard panel. Keep those panels
together when explaining the sidebar; their editor-specific panel bodies and controls are not shell
layout anchors.

## Layout

```
+---------------------------------------------------------------------+
| [page-nav] [left-slot controls]              [right-slot] [switch]  |  shared TextChrome/PageToolbar row: navigation and left slot at left, switch at right
| [Home] [Back] [Forward] [Reload] [url-input] … [Close]              |  Browser's own toolbar, with no generic navigation or switch
| [board controls]                              [editor switch]       |  custom BoardToolbarView row
+---------------------------------------------------------------------+
| [sidebar panel stack] [sidebar splitter] | [active page editor]     |  sidebar left of the page content; splitter at its right edge
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Page navigation → `page-nav-panel`
- Sidebar container → `secondary-views-container`
- Sidebar stack → `secondary-views-stack`
- Sidebar splitter → `secondary-views-splitter`

### When the Explorer sidebar is open

```
+---------------------------------------------------------------------+
| [Explorer panel header actions]                             [Close] |  Explorer panel header above its body
| [Explorer file/board/tool/ref rows]                                 |  Explorer panel body below the header
+---------------------------------------------------------------------+
```

### When Search is open

```
+---------------------------------------------------------------------+
| [Search panel body]                                  [Close]        |  Search sidebar panel body with close at the right edge
+---------------------------------------------------------------------+
```

### When Boards is open

```
+---------------------------------------------------------------------+
| [Boards/Tools switch]                              [Boards close]   |  Boards panel header and switch at the top of the panel body
| [active Boards or Tools list]                                       |  repeated board or toolset list below the switch
| [empty state: message]                                              |  Boards empty state message
| [Create] [Create Demo]                                              |  Boards empty-state actions below the message
+---------------------------------------------------------------------+
```

### When Clipboard is open

```
+---------------------------------------------------------------------+
| [Clipboard] [health badge]       [Clear] [Restart] [Close]            |  Clipboard panel header; badge appears when disabled or unavailable
+---------------------------------------------------------------------+
| [clipboard history list]                                           |  newest-first captured items; each row has an icon, preview, and time badge
| [disabled warning] [Open Settings]                                  |  disabled state only
| [Copy]                                                             |  per-item action, swaps with the time badge on row hover or focus
+---------------------------------------------------------------------+
```

Clipboard can be opened from **Tools & Editors** even while history is disabled. In that state the
panel shows a **Disabled** badge and a top warning with **Open Settings**; **Restart** is not shown.
Stored rows remain usable: click a row to open its content in the current page, right-click for
**Remove**, use **Clear** to remove all history after confirmation, or use the row's **Copy** action.
The current row has a persistent selection highlight. Each row begins with an icon for its content
type, followed by its preview text. The outlined time badge shows `hh:mm` for today, `-1d hh:mm`
for yesterday, or `-Nd hh:mm` for older items; its tooltip says `Today at hh:mm`, `1 day ago`, or
`N days ago`. The badge swaps in place with **Copy** while the row is hovered or focused. Press
**Arrow Up** or **Arrow Down** while the list is focused to select and open the previous or next
row; **Home**, **End**, page navigation, and **Enter** keep their usual list behavior. Copying returns the content
as a new newest row and the selection follows it. File-list rows open as a readable list of the
stored absolute paths, rather than the watcher's metadata JSON.
The **Clipboard** header button in Explorer remains available only while history is enabled; use
**Tools & Editors** for the dedicated Clipboard page in either state. The health badge and
**Restart** action appear for enabled-listener failures; **Clear** appears when the panel is expanded
and has items.

### When Git is open

```
+---------------------------------------------------------------------+
| [Git tabs] [Git sort]                         [Refresh] [Close]     |  Git panel toolbar and header actions
| [repository name]                                                   |  Git panel header beside its title
| [Git Changes: unstaged]                                             |  upper Git Changes list
| [changes splitter]                                                  |  between the Git Changes lists
| [Commit] [Stage] [Unstage]                                          |  Git Changes toolbar above the staged list
| [Git Changes: staged]                                               |  lower Git Changes list
| [Branches tree] [Tags tree]                                         |  Git ref bodies below the changes view
+---------------------------------------------------------------------+
```

- Explorer panel body → `explorer-secondary-view`
- Explorer header actions → `explorer-header-actions`
- Up → `explorer-up`
- Search → `explorer-search`
- Boards → `explorer-boards`
- Clipboard → `explorer-clipboard`
- Collapse all → `explorer-collapse-all`
- Explorer close → `explorer-close`
- Matching board → `explorer-open-board`
- Matching toolset → `explorer-open-toolset`
- Matching Git entry → `explorer-open-git`
- Matching Mneme entry → `explorer-open-mneme`
- Search panel body → `search-secondary-view`
- Search close → `search-secondary-close`
- Boards empty → `boards-empty`
- Boards empty actions → `boards-empty-actions`
- Create board in empty state → `boards-create-empty`
- Create Demo board in empty state → `boards-create-demo-empty`
- Boards panel body → `boards-secondary-view`
- Boards/Tools switch bar → `boards-tools-switch-bar`
- Boards close → `boards-close`
- Clipboard panel body → `clipboard-secondary-view`
- Clipboard header actions → `clipboard-header-actions`
- Clipboard close → `clipboard-close`
- Clipboard clear → `clipboard-clear`
- Clipboard disabled warning → `clipboard-notification` (disabled state only)
- Open Settings → `clipboard-open-settings` (disabled state only)
- Clipboard history list → `clipboard-history`
- Clipboard health badge → `clipboard-health` (disabled or unavailable state only)
- Clipboard restart → `clipboard-restart` (enabled-listener failure only)
- Boards/Tools switch → `boards-tools-switch`
- Create board → `boards-create`
- Boards list → `explorer-boards`
- Tools list → `explorer-tools`
- Git panel body → `git-panel`
- Git toolbar → `git-panel-toolbar`
- Git tabs → `git-panel-tabs`
- Git ref sort → `git-branches-sort-alpha`
- Git header actions → `git-panel-header-actions`
- Git refresh → `git-panel-refresh`
- Git close → `git-panel-close`
- Repository name → `git-panel-repo-name`
- Git Changes → `git-changes`
- Unstaged list → `git-changes-unstaged`
- Staged list → `git-changes-staged`
- Changes toolbar → `git-changes-toolbar`
- Changed file → `git-changes-file`
- Commit → `git-commit`
- Stage → `git-stage`
- Unstage → `git-unstage`
- Changes splitter → `git-changes-splitter`
- Branches tree → `git-branches-tree`
- Tags tree → `git-tags-tree`

### When the sidebar is closed

```
+---------------------------------------------------------------------+
| [active page editor]                                                |  page area after the sidebar is closed
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Browser Home, Back, Forward, Reload, address bar, Navigate, Bookmarks, Downloads, More, DevTools, and Close — no entry in this sidebar list: Browser owns its custom toolbar; see the [Browser editor guide](../editors/browser.md) for its editor facade.
- Board-specific toolbar controls — no entry: custom board content; the embedded switch is the supported anchor.
- File, board, tool, ref, changed-file, and clipboard history rows — no entry: repeated data rows are addressed through panel state/actions; the dynamic declarations cover stable roots and actions. Clipboard row Copy buttons are repeated controls.

Evidence: `PageContentView.ts:91-125`, `SecondaryViewsView.ts:69-80`, `PageToolbarView.ts:180-205`, and the Explorer, Search, Boards, and Git panel views cited in the plan.

## Shared sidebar frame

| Element | What it is for | Selector |
|---|---|---|
| Content region below the header | The page area | `[data-name="app-content"]` |
| Page navigation control | Opens the file Explorer sidebar | `[data-name="page-nav-panel"]` |
| Page host | Every page lives here | `[data-name="pages-container"]` |
| Active page editor container | The editor body for the active page | `[data-name="page-editor"]` |
| Empty page | The page state before content is opened | `[data-name="page-empty"]` |
| Sidebar panel container | Present while a page has panels open | `[data-name="secondary-views-container"]` |
| Sidebar panel stack | The collapsible stack of page panels | `[data-name="secondary-views-stack"]` |
| Sidebar width splitter | Resizes the sidebar | `[data-name="secondary-views-splitter"]` |

### Explorer

Explorer shows the current page's file or folder context. Its root can be a directory, archive, or
another provider-backed location. Persephone has no separate workspace feature, workspace files,
workspace settings, or multi-root workspaces: a page whose Explorer is rooted at a project folder
is that project's workspace. The root row shows the full root path beside the folder name; narrow
sidebars shorten the path from the left while keeping the folder name visible. Use the Explorer
panel's own actions to select and open items,
navigate upward, search the root, switch to Boards, or open Clipboard when clipboard history is
enabled. An Explorer panel can be closed from its header; its dynamic editor-specific names are
deliberately not part of this shell contract. The dedicated Clipboard page is opened from
**Tools & Editors** and does not depend on that Explorer shortcut.

### Clipboard

Clipboard is a page-owned sibling panel of Explorer. It lists captured text, HTML, images, and file
lists newest first. Select an item to open it in the host page, use its **Copy** action to put it back
on the Windows clipboard, right-click for **Remove**, or use **Clear** in the panel header to remove
all items. The selection marks the item currently shown; while history is enabled, copying it creates
a new top row and keeps the selection with that content. File-list items open as one absolute path per line. Clipboard
history is opt-in and is configured in [Settings](./settings.md#clipboard-history). When enabled, copies
made anywhere inside Persephone—including the Text Editor/Monaco and a Browser tab—appear here too;
capture depends on the copy reaching the Windows clipboard, not on which editor or page supplied it.
Stored rows remain available for browsing and cleanup while the feature is disabled.

### Search

Search is a sibling panel in the same frame. It records the query, include and exclude patterns,
search folder, result rows, and match counts. Open a result through the Search panel so the page
model performs the navigation; do not infer a file path from a repeated visual row.

### Boards

Boards uses the shared frame to show boards and toolsets associated with an Explorer root. Its
Boards/Tools switch is panel-owned. Board creation and board-specific controls are not shell
anchors, and the detailed board surface belongs in the [Boards guide](../boards.md).

For the live panel model, call `page.panels.items`. Each item reports a bare panel ID, label,
owning editor instance, editor kind, and expanded state. `page.panels.expand(id)` takes that bare
ID. `page.panels.toggleSidebar()` flips the existing sidebar, throws when there are no panels or a
non-Explorer panel keeps it open, and does not create an Explorer. There is no uniform
`page.panels.close(id)`: each panel header owns its hide/dispose lifecycle.
