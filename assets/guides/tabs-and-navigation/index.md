---
title: "Tabs & Navigation"
audience: both
summary: "How do users manage tabs, navigate pages, and restore sessions?"
---

# Tabs & Navigation

## Tab Management

Each open file appears as a tab in the tab bar. Tabs show the file name, a language icon, and an unsaved-changes indicator (dot).

### Creating Tabs

| Action | How |
|--------|-----|
| New empty tab | `Ctrl+N` or click the **+** button |
| New with specific editor | Click the dropdown arrow (&#9662;) next to **+** — shows Top, named editor categories, and Other; choose **Show all…** to open the Tools & Editors hub |
| Open a file | `Ctrl+O`, or drag a single file onto the window |
| Open multiple files or a folder | Drag multiple files or a folder onto the window — opens a link collection page listing all files. Click any file to view it in the main area. Subfolders become link categories. |

### Closing Tabs

| Action | How |
|--------|-----|
| Close current tab | `Ctrl+W` or `Ctrl+F4` |
| Close via tab | Click the **X** on the tab |
| Close other tabs | Right-click tab → **Close Other Tabs** |
| Close tabs to the right | Right-click tab → **Close Tabs to the Right** |

If a file has unsaved changes, you'll be prompted to save before closing.

### Switching Tabs

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` | Switch to next tab |
| `Ctrl+Shift+Tab` | Switch to previous tab |
| Click a tab | Switch to that tab |

When you activate a tab that is outside the visible part of the tab bar, the tab bar scrolls just
enough to bring it into view. Activating a tab that is already visible does not recenter the tab bar.

## Page history

Each page keeps its own Back and Forward destinations when it navigates in place. Use the Back and
Forward buttons in the regular header, `Alt+Left` / `Alt+Right`, or physical mouse buttons 4 / 5.
The controls act on the active work page; opening a right-pinned page in its popover does not make
it the active page. A new navigation after going Back clears Forward. History is restored with the
session. A declined save prompt leaves the page and its stacks unchanged, and untitled content with
no addressable source does not get a history entry. Browser pages keep separate webview history;
the shell history controls are disabled while a Browser page is active.

See [Header Strip](../screens/header.md) for button placement and [the page scripting API](../scripting/api/page.md#pagehistory)
for reading and driving a page's history.

### Slow content opens

Some editors opt to show a page while its content is still restoring, so the tab is available
before a slow source has finished loading. The editor's status bar (its footer) shows a pipe status badge; click
it to inspect the provider and transformer stages. The close icon on the loading tile closes a page
that is still loading, and **Retry** appears if loading fails. See [Page Area and Sidebar](../screens/sidebar.md#while-page-content-is-restoring).

Scripts that need restored content can await
[`page.ready`](../scripting/api/page.md#content-restore-and-pipe-status); the same page API
describes `page.pipe` and its status.

### Moving Tabs

- **Reorder** — drag and drop tabs within the tab bar to rearrange them
- **Detach to new window** — drag a tab outside the window and drop it to open it in a separate window
- **Move between windows** — drag a tab from one persephone window and drop it into another window's tab bar
- **Open in New Window** — right-click a tab and select "Open in New Window"

### Pinning Tabs

Pin tabs on either side of the header. Left-pinned tabs stay compact in the main tab strip. A
right-pinned tab appears as a chip beside the window controls and opens in a popover, so you can
refer to it while keeping your active work page selected.

- **Pin left** — right-click a tab → **Pin to the left**
- **Pin right** — right-click a tab → **Pin to the right**
- **Unpin** — right-click a pinned tab → **Unpin**
- **Show or hide a right-pinned page** — click its chip in the header. Press `Escape` or click
  another app-shell control outside the popover to close it.

**Pinned tab behavior:**

- Left-pinned tabs are compact icon-only tabs at the left of the main strip and stay fixed while
  the rest of that strip scrolls.
- Right-pinned tabs are compact icon chips at the right of the header; click one to open its page
  in a resizable popover over the active work page. Clicking the same chip toggles it closed.
- Drag the popover's left edge to change its width, its bottom edge to change its height, or its
  bottom-left corner to change both; the pointer changes shape over them. Each page remembers its size, and resizing
  the window does not change it (a smaller window only caps it). Drag it to the full height of the
  window and it stays full height as the window resizes, like a side panel; drag it shorter to go
  back to a fixed height.
- Right-pinned pages do not become the active work page. Use the active page as usual while the
  popover is open, or access the popover page through `app.pages.popoverPage` in scripts.
- Pinned tabs cannot be closed directly or dragged to another window. Right-pinned pages cannot
  be grouped; move one to the left or unpin it before grouping.
- Left-pinned tabs can be reordered among other left-pinned tabs; right-pinned chips can be
  reordered among the right-pinned pages by dragging.
- Show an editor icon, encryption icon (if applicable), and modification indicator
- **File path tooltip** — hover over a pinned tab to see the full file path (1.5s delay)
- Content can be replaced via the File Explorer panel (in-tab navigation)
- Pinned state is preserved across app restarts
- A window with pinned tabs is preserved on close (can be reopened from "Open Tabs" in sidebar)

### Tab Context Menu

Right-click a tab to open its context menu. The available **tab-level items** depend on whether
the tab is in the main strip or is a right-pinned chip; **editor-specific items** depend on what
the tab contains.

**Tab-level items:**

| Action | Description |
|--------|-------------|
| Close Tab | Close this tab (not available for pinned tabs) |
| Close Other Tabs | Close all tabs except this one (skips pinned tabs) |
| Close Tabs to the Right | Close all tabs after this one (skips pinned tabs; not available for pinned tabs) |
| Open in New Window | Move this tab to a new window (not available for pinned tabs) |
| Duplicate Tab | Create a copy of this tab grouped side-by-side (not available on right-pinned chips) |
| Pin to the left / Pin to the right / Unpin | Choose a pin side or remove the pin |

**Editor-specific items:**

Right-pinned chips offer pin-side and unpin actions, plus any actions contributed by their editor;
they do not offer the other tab-level actions. Each editor contributes only relevant actions.
Editors with no specific actions (e.g. MCP Inspector) show no greyed-out entries.

*Text editor tabs:*

| Action | Description |
|--------|-------------|
| Save | Save the file |
| Save As... | Save with a new name |
| Rename | Rename the file/tab |
| Show in File Explorer | Open the file's folder in Windows Explorer |
| Copy File Path | Copy the full file path to clipboard |
| Encrypt / Change Password | Encrypt the file or change its password (see [Encryption](../encryption.md)) |
| Decrypt | Decrypt an encrypted file |
| Make Unencrypted | Remove encryption from a file |

*Git Tree tabs:*

| Action | Description |
|--------|-------------|
| Open Git Root Folder | Reveal the repository root folder in Windows Explorer |
| Copy Remote URL | Copy the configured remote URL (origin preferred) to the clipboard |

*Image and Archive tabs:*

| Action | Description |
|--------|-------------|
| Show in File Explorer | Open the source file's folder in Windows Explorer |
| Copy File Path | Copy the source file's full path to clipboard |

*HTML file tabs (`.html`, `.htm`, `.xhtml`):*

| Action | Description |
|--------|-------------|
| Open in Browser | Open the local HTML file in Persephone's built-in browser |
| Show in File Explorer | Open the file's folder in Windows Explorer |
| Copy File Path | Copy the full file path to clipboard |

*Board tabs:*

| Action | Description |
|--------|-------------|
| Copy Board Path | Copy the board's folder path to the clipboard |
| Open Board Folder | Open the board's folder as a new workspace page with the File Explorer panel rooted at that folder |

A board that is also editing a file can show the file editor's actions as well. In that case,
**Copy Board Path** and **Open Board Folder** appear after those file actions.


## Read next

| What you need | Page (object-model path) |
|---|---|
| Menu bar | [menu-bar](menu-bar.md) - `guides["tabs-and-navigation"]["menu-bar"]` |
| Page sidebar panels and file explorer | [file-explorer-and-panels](file-explorer-and-panels.md) - `guides["tabs-and-navigation"]["file-explorer-and-panels"]` |
| Grouping, session restore and file watching | [grouping-session-and-watching](grouping-session-and-watching.md) - `guides["tabs-and-navigation"]["grouping-session-and-watching"]` |
