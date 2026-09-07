---
title: "Page Tabs"
audience: both
summary: "Page tabs, language and close controls, grouping, pinned tabs, and session restoration."
screen: "tabs"
---

# Page Tabs

Each open page has a tab in the header's tab strip. Tabs can be reordered, dragged to another
window, grouped side by side, pinned, or closed. The active tab identifies the page whose editor
is visible below the header.

## Layout

## Tab controls and states

| Element | What it is for | Selector |
|---|---|---|
| Any tab | One per open page | `[data-name="page-tab"]` |
| Active tab | The page currently shown | `[data-name="page-tab"][data-active]` |
| Language button | Chooses Monaco syntax highlighting for the active page | `[data-name="tab-language"]` |
| Close button | Closes a page, or ungroups it when grouped; becomes a dot for unsaved changes | `[data-name="tab-close"]` |
| Mute button | Appears when the page plays audio | `[data-name="tab-sound"]` |
| Title text | The visible tab title | `[data-part="title-label"]` |

Tab state attributes include `data-active`, `data-modified`, `data-pinned`, `data-temp`,
`data-deleted`, `data-grouped`, and `data-has-encryption`.

## Language and pinned-tab shapes

“Language” here always means the Monaco syntax-highlighting mode: JavaScript, JSON, Python, and
so on. It does not mean the app's UI locale or a spoken language. The feature is the tab language
button and the `language` field on `pages.addEditorPage` and `pages`.

Editors that declare no language—most grids, notebooks, browsers, boards, and app pages such as
Tools & Editors—show no `tab-language` button. An editor icon appears in its place as
`[data-part="empty-language"]`; a missing button is expected. Check `pages` before searching the
DOM. A pinned tab shows only icons: its title label is empty and the file path is in a hover
tooltip. Read the real title from `pages`.

## Grouping

`Ctrl+click` a second tab to show two pages side by side. The grouped tab's close control ungroups
the page instead of closing it. Script output goes to the grouped page.

## Tab menu

Right-click a tab for **Close Tab**, **Close Other Tabs**, **Close Tabs to the Right**, **Open in
New Window**, **Duplicate Tab**, and **Pin/Unpin Tab**, plus actions contributed by the current
editor. Editors without specific actions, including MCP Inspector, show only universal tab items.

## Session restore

At startup, Persephone always attempts to restore a valid saved `openFiles` session state. There
is no setting to disable this. A missing, unreadable, or non-version-4 state simply restores no
pages; startup continues and the empty-page check runs. A valid state reconstructs its persisted
pages and groupings before command-line file or URL arguments are handled.

`window.close-to-tray` is unrelated: it controls whether closing the last window hides Persephone
in the notification tray or quits it. It does not turn session restoration on or off.

