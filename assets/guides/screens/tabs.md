---
title: "Page Tabs"
audience: both
summary: "Page tabs, language and close controls, grouping, pinned tabs, and session restoration."
screen: "tabs"
---

# Page Tabs

Each open page has a tab in the header. Work pages and left-pinned pages appear in the scrolling
strip; right-pinned pages appear as compact chips beside the window controls. Tabs can be reordered,
dragged to another window, grouped side by side, pinned, or closed. The active tab identifies the
work page, while opening a right-pinned page shows it in a popover over that page.

## Layout

```
+---------------------------------------------------------------------+
| [page-tab] [language] [title] [sound]               [close/ungroup] |  one tab in the header strip; conditional controls stay inside it
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Page tab → `page-tab`
- Right-pinned chip strip → `right-page-tabs`
- Language/editor type → `tab-language`
- Close or ungroup → `tab-close`
- Sound indicator → `tab-sound`
- Tab title → no entry: content text, not an addressable control

### When a tab is grouped or modified

```
+---------------------------------------------------------------------+
| [page-tab] [title]                                [close/ungroup]   |  grouped or modified tab, with its edge action on the right
+---------------------------------------------------------------------+
```

### When a tab is active, inactive, or left-pinned

```
+---------------------------------------------------------------------+
| [active tab] [inactive tab] [left-pinned icon tab]                  |  work tabs in the scrolling header strip
+---------------------------------------------------------------------+
```

### When right-pinned tabs exist

```
+---------------------------------------------------------------------+
| [work tabs]                         [right-pin] [right-pin] [window] |  right-pinned chips sit before window controls
+---------------------------------------------------------------------+
```

Click a right-pinned chip to show its page in a resizable popover over the work page. Click the
same chip again, press `Escape`, or click another app-shell control outside the popover to close it.
The popover does not replace the active work page. Right-pinned pages cannot be grouped, closed
from the tab, or moved to another window; right-click one to unpin it or move it to the left.

### When a language control exists

```
+---------------------------------------------------------------------+
| [page-tab] [language/editor type] [title]                           |  language/editor-type control inside this tab
+---------------------------------------------------------------------+
```

### When the sound indicator is shown

```
+---------------------------------------------------------------------+
| [page-tab] [title] [sound indicator]                  [close]       |  audible or muted tab with its edge action
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Tab title text — no entry: title is content, not an interactive control.
- Tab right-click menu — no entry: transient popup outside the shell contract.

Evidence: `PageTabView.ts:136-158,370-403` and `ui-element-contract.md:98-124`.

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
DOM. A left-pinned tab shows only icons: its title label is empty and the file path is in a hover
tooltip. A right-pinned tab is an icon chip in the separate right strip and also shows its file
path on hover. Read the real title from `pages`.

## Grouping

`Ctrl+click` a second tab to show two pages side by side. The grouped tab's close control ungroups
the page instead of closing it. Script output goes to the grouped page.

## Tab menu

Right-click a tab for **Close Tab**, **Close Other Tabs**, **Close Tabs to the Right**, **Open in
New Window**, **Duplicate Tab**, and **Pin/Unpin Tab**, plus actions contributed by the current
editor. An unpinned tab can be pinned to the left or right. A left-pinned tab can be unpinned or
moved right; a right-pinned chip can be unpinned or moved left. Right-pinned chips do not offer
close, duplicate, grouping, or window-move actions. Editors without specific actions, including
MCP Inspector, show only the available tab items.

## Session restore

At startup, Persephone always attempts to restore a valid saved `openFiles` session state. There
is no setting to disable this. A missing, unreadable, or non-version-4 state simply restores no
pages; startup continues and the empty-page check runs. A valid state reconstructs its persisted
pages and groupings before command-line file or URL arguments are handled.

`window.close-to-tray` is unrelated: it controls whether closing the last window hides Persephone
in the notification tray or quits it. It does not turn session restoration on or off.

When an editor opts into deferred content restore, a newly opened page can appear before its
content is ready. The page area shows live source stages while it loads, with **Cancel** to close
the page and **Retry** if loading fails. See [Page Area and Sidebar](./sidebar.md#while-page-content-is-restoring).
