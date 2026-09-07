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
