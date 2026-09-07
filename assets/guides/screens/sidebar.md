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

The same frame hosts Explorer, Search, and Boards. Keep those panels together when explaining the
sidebar; their editor-specific panel bodies and controls are not shell layout anchors.

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

- Browser Home, Back, Forward, Reload, address bar, Navigate, Bookmarks, Downloads, More, DevTools, and Close — no entry in this sidebar list: Browser owns its custom toolbar; its editor facade is owned by US-1376.
- Board-specific toolbar controls — no entry: custom board content; the embedded switch is the supported anchor.
- File, board, tool, ref, and changed-file rows — no entry: repeated data rows are addressed through panel state/actions; the dynamic declarations cover stable roots and actions.

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
another provider-backed location. Use the Explorer panel's own actions to select and open items,
navigate upward, search the root, or switch to Boards. An Explorer panel can be closed from its
header; its dynamic editor-specific names are deliberately not part of this shell contract.

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
