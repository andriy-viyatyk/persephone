---
title: "Header Strip"
audience: both
summary: "The header strip, status indicators, and the screen destinations they open."
screen: "header"
---

# Header Strip

The header strip is the app chrome across the top of every Persephone window. It contains the
Persephone menu, page tabs, page creation controls, window controls, and conditional status
indicators. This guide covers the header itself; the screens opened by its indicators have their
own guides.

The header and its status cluster are app-owned shell elements. Use their purpose and current
visibility to decide what to point out, rather than assuming that every control is present in
every state.

## Layout

```
+---------------------------------------------------------------------+
| [P] [tab] [tab] [tab] … [+ ▾]                          [–] [□] [×]  |  header strip: Persephone menu far left, then the tab strip
|                                                  [Snip][Mneme][MCP] |  and + button; window controls top-right, status bottom-right
+---------------------------------------------------------------------+
| Page area                                                           |  everything below the header strip
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Header strip → `app-header`
- Persephone menu → `persephone-menu`
- Page tabs → `page-tabs`
- Page tabs wrapper → `page-tabs-wrapper`
- Scroll left → `page-tabs-scroll-left`
- Scroll right → `page-tabs-scroll-right`
- Add page → `page-tabs-add`
- Autoload reload → `autoload-reload`
- Zoom indicator → `zoom-indicator`
- Minimize → `window-minimize`
- Restore → `window-toggle`
- Close → `window-close`
- Status indicators → `status-indicators`
- Snip → `header-snip-button`
- Mneme → `mneme-indicator`
- MCP → `mcp-indicator`

### When the tabs overflow

```
+---------------------------------------------------------------------+
| [scroll left] [visible tabs]                         [scroll right] |  overflowed tab strip with arrows at both edges
+---------------------------------------------------------------------+
```

### When autoload files need a reload or the window is zoomed

```
+---------------------------------------------------------------------+
| [autoload reload] [zoom indicator]                                  |  conditional header controls at the left of the spacer
+---------------------------------------------------------------------+
```

### When Mneme or MCP is enabled

```
+---------------------------------------------------------------------+
|                                                  [Snip][Mneme][MCP] |  bottom-right status cluster, in live left-to-right order
+---------------------------------------------------------------------+
```

### When the Snip menu is open

```
+---------------------------------------------------------------------+
|                                                  [Snip Screen]      |  Snip popup surface opened from the bottom-right status cluster
|                                                  [Snip Persephone]  |
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Snip Screen and Snip Persephone popup items — no entry: transient popup surface, outside the shell contract.
- Split primary and split caret — no entry: internal parts of the addressable `page-tabs-add` split control.
- Header spacer — no entry: structural spacer, not a user control.

Evidence: `MainPageView.ts:108-129,160-201`, `MainPage.css:16-28`, and `PageTabsView.ts:35-84`.

## Header strip

| Element | What it is for | Selector |
|---|---|---|
| Header strip | The top application chrome | `[data-name="app-header"]` |
| Persephone glyph | Opens the Menu Bar, the app's only menu | `[data-name="persephone-menu"]` |
| Tab strip | One tab per open page; tabs can be reordered, moved to another window, or opened in the tab menu | `[data-name="page-tabs"]` |
| Tab strip scroll area | The scrollable wrapper around tabs | `[data-name="page-tabs-wrapper"]` |
| Scroll arrows | Appear only when tabs overflow | `[data-name="page-tabs-scroll-left"]`, `[data-name="page-tabs-scroll-right"]` |
| Add-page split button | The main action adds an empty page; its arrow opens the editor menu | `[data-name="page-tabs-add"]` |
| Autoload reload | Appears when changed autoload scripts need re-running | `[data-name="autoload-reload"]` |
| Zoom indicator | Appears only when the window is zoomed and resets zoom on click | `[data-name="zoom-indicator"]` |
| Window controls | Minimize, maximize/restore, and close | `[data-name="window-minimize"]`, `[data-name="window-toggle"]`, `[data-name="window-close"]` |

The `+` button creates an empty page with `Ctrl+N`; its arrow offers the editors and browser
profiles the user can start from. `Ctrl+Shift+N` opens a new window. The tab strip's language,
close, sound, title, and state controls belong to [Page Tabs](./tabs.md).

## Status indicators

The status cluster sits at the bottom-right of the header. It is small and muted, and each item is
conditional.

| Element | What it is for | Selector |
|---|---|---|
| Indicator cluster | Container for status indicators | `[data-name="status-indicators"]` |
| Snip menu trigger | Offers **Snip Screen** and **Snip Persephone**; the capture opens in a new Image View page | `[data-name="header-snip-button"]` |
| Mneme indicator | Appears when Mneme is enabled; green means an embedding model is running, yellow means semantic search is unavailable, and grey means enabled but not running | `[data-name="mneme-indicator"]` |
| MCP indicator | Appears while the MCP server is running; it shows idle status or the connected-client count and opens the MCP request log | `[data-name="mcp-indicator"]` |

The indicators are entry points, not the screen guides for their destinations. Mneme's Config &
monitoring and root search editors are documented in [Mneme](../mneme.md), and MCP connection
inspection is documented in [MCP Inspector](./mcp-inspector.md). The snip menu opens an Image View
page after capture.

The header's conditional controls are not errors when absent. Check the current state with
`ui.elements` or `window.screen.snapshot()` before describing one. Use `ui.highlight` to point at a
named control; `ui.guide.step` points at one and waits for the user. For a control outside the
header, pass its CSS selector or bare `data-name` instead. A visible backdrop for the Menu
Bar is also not proof that the Menu Bar is open; its `[data-name="menu-bar"]` element remains in the
DOM while closed.
