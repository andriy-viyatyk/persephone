---
title: "Menu Bar"
audience: both
summary: "How do the menu bar, sidebar tools, and editor commands work?"
---

# Menu Bar

## Menu Bar

Click the **persephone icon** (top-left) to open the Menu Bar. It has a two-panel layout:

### Left Panel — Folder List

The left side shows your folder shortcuts:

- **Open Tabs** — Lists all open pages in the current window and other open windows
- **Recent Files** — Recently opened files
- **Tools & Editors** — All creatable editors and tools (see below)
- **Script Library** — A dedicated folder for your reusable scripts (see below)
- **Custom Folders** — Your bookmarked filesystem folders

Click a folder in the left panel to see its contents in the right panel.

**Open Folder in New Tab:**
- When a custom folder is selected, click the chevron (▶) icon, double-click the folder, or right-click it and choose **Open in New Tab** to open a new tab with the File Explorer panel showing that folder's contents
- This gives you a full-width file browser alongside an editor, without keeping the sidebar open

**Managing Custom Folders:**
- Click the **Add Folder** button at the bottom of the left panel to pick a folder and add it as a shortcut
- Right-click in the left panel for the same **Add Folder** option, plus **Open in New Tab**, **Show in File Explorer**, **Open Terminal here** (Windows and Linux — see [Open Terminal here](file-explorer-and-panels.md#open-terminal-here)), and **Remove Folder** on an existing shortcut
- Folders provide quick access to frequently used directories

### Right Panel — Contents

The right panel shows the contents of the selected folder:

**Open Tabs view:**
- Lists all open tabs in the current window
- Shows tabs from other open persephone windows (grouped by window)
- Click any entry to switch to that tab

**Recent Files view:**
- Shows recently opened files
- Right-click for options: Open, Open in New Window, Show in File Explorer, Remove from Recent

**Custom Folder view (File Explorer):**
- Browse files and folders in a tree view
- Click a file to open it
- Right-click a file or folder for the clipboard group **Cut**, **Copy**, **Paste**, followed by
  the shared edit group **Rename**, **Delete**, **New File**, **New Folder**. On a file row, Paste
    and the new-item actions target its parent folder; on a folder row, they target that folder.
    File clipboard copy and cut work on Windows and Linux. Clipboard history is available on Windows;
    it is unavailable on Linux; GNOME Wayland has no supported way for apps to watch the clipboard.
- Right-click a folder for **Open Terminal here** (Windows and Linux — see [Open Terminal here](file-explorer-and-panels.md#open-terminal-here))
- Search files by name with `Ctrl+F` when the file explorer is active
- **Drag a file out to the OS** — drag a file from the tree onto Windows Explorer, GNOME Files or into a Microsoft Teams chat to copy/attach it there. No modifier key needed. Dragging it into another folder in the tree instead asks whether to **Move** or **Copy** it there. Currently one file at a time.
- **Drop files from the OS** — drag a file or folder from Windows Explorer, GNOME Files or another app onto a folder in the tree; a **Move / Copy / Cancel** dialog asks which you want (folders are handled recursively), and dropping onto an existing name asks for confirmation before overwriting.

### Menu Bar Buttons

| Button | Action |
|--------|--------|
| Open File | Opens file dialog (`Ctrl+O`) |
| New Window | Opens a new persephone window (`Ctrl+Shift+N`) |
| About | Opens the About page (version info, update check) |
| Settings | Opens the Settings page (themes, preferences) |

If a standalone page cannot be opened because its editor fails to load, Persephone reports the failure with an error notification instead of silently doing nothing.

### About guide browser

The About page keeps the application information card on the left and the guide browser on the
right. The contents view lists the available guides with summaries, release highlights, and
resources. Documentation supplied by trusted installed boards appears under the
**installed-boards** branch. Turn on **Show agent guides** to include guides intended for AI agents.

Select a guide to read it in the right pane. Use **Back** to return to the previous guide location,
or **Open in tab** to open the guide as a normal Markdown tab while leaving the About page available.
Pressing `F1` opens the guide contents (or the active editor's guide); the **About** Menu Bar item preserves
the current guide-browser location.

### Tools & Editors

The **Tools & Editors** entry appears between Recent Files and Script Library. Its slide-out panel has **Editors** and **Tools** tabs. Editors combines built-in editors with every trusted [board](../boards/index.md), including boards associated with file types, grouped by folder. Click an item to open it; right-click bundled boards to **Disable** or **Enable** them. Disabled bundled boards remain in the tree for management but cannot be assigned to a category.

In the full **Tools & Editors** hub, the **Editors** tab has the fully expanded editor tree on the left and the category manager on the right. Drag the splitter to resize the Categories pane; it stays between 30% and 70% of the hub width. The filter at the right of the tab row appears only on Editors and matches names in the tree. Matching a folder keeps all its boards visible. Tree rows show a bordered category chip, and boards with an available update show an accent **Update** chip.

**Top** is fixed first; create, rename, reorder, and delete named categories in the hub. Drag editor rows into categories, reorder items within a category, or drag a categorized item onto the Editors tree to return it to **Other**. Drag a category header onto another header to place it before that category. Deleting a nonempty category moves its members to **Other**. Categories persist across restarts.

The **+** dropdown shows **Top**, nonempty named categories, and **Other**. Its filter narrows the list, with **Show all…** beside it, and opens the hub. The menu opens below the caret with its left edge aligned to the caret's left edge; resize it from the lower-right corner and its size is remembered. When category columns extend beyond the visible width, use the mouse wheel to scroll horizontally. On a fresh install, Top starts with **Open Folder**, **Open File**, Script (TS), **Excalidraw**, Grid (CSV), and Browser. The Categories pane also scrolls horizontally with the mouse wheel when its columns overflow.

Bundled boards such as **Excalidraw** appear under the **Built-in** root in **Editors**. Right-click a bundled board and choose **Disable** to remove its file
association and capabilities. It stays listed, greyed out, so you can right-click it again and
choose **Enable**. If no replacement handles an image or diagram handoff while it is disabled,
Persephone shows the corresponding “No … editor is registered” message.

**Open in new tab** — A button in the panel header opens the same content as a full page. The hub also has **Search boards** and **Site extensions** tabs. **Search boards** browses the published catalog and lets you install a board directly. See [Boards — Published boards catalog](../boards/published-boards.md#published-boards-catalog--discover-install-update).

**Open Folder** — The first entry in the default Top category. Clicking it shows a native Select Folder dialog; once you pick a folder, a new tab opens with the File Explorer panel rooted at that folder — Persephone's equivalent of a VS Code workspace. This is identical to right-clicking a folder in the Explorer sidebar and choosing **"Open in New Tab"**.

Items include all standard editors (Script, Grid, Links, Excalidraw, Browser, Video Player) and tools such as **Clipboard** on supported platforms and MCP Inspector, as well as individual browser profiles (Incognito and named profiles). Clipboard is available regardless of the clipboard-history setting on Windows.

**Clipboard** — On Windows, opens one dedicated page whose sidebar contains the Clipboard history panel. If
history is disabled, the panel shows a **Disabled** badge, an explanation, and an **Open Settings**
button; existing rows can still be opened, copied, removed, or cleared. A restored panel on Linux
shows an unavailable message and can be closed. See [Page Area and Sidebar](../screens/sidebar.md#clipboard).

### Script Library

The **Script Library** entry appears below Recent Files and provides quick access to a folder of reusable scripts.

- **First time:** Click "Script Library" to see a placeholder with a **Select Folder** button. A setup dialog opens where you pick a folder and optionally copy bundled example scripts into it.
- **After linking:** The right panel shows a File Explorer rooted at your library folder. Click any script to open it.
- **Open in New Tab:** Double-click the "Script Library" entry (or click its icon when selected) to open the library in a full File Explorer tab — same behavior as custom linked folders.
- **Context menu:** Right-click the "Script Library" entry for **Change Library Folder**, **Open in Explorer**, or **Unlink Library**.
- **Settings:** You can also configure the library path in **Settings → Script Library** (browse, change, or unlink).

### Closing the Sidebar

Click anywhere outside the sidebar, or press **Escape** to close it.

