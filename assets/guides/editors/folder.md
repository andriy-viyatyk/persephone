---
title: "Folder View"
audience: both
summary: "Folder and archive-directory browsing with list/tile views, navigation, and file operations."
editorId: "category-view"
---

# Folder View

Folder View browses local folders and archive directories with breadcrumbs, list/tile layouts, image
thumbnails, and file operations appropriate to the location.

## How to Open

Click a folder in File Explorer or an Archive panel. Archive folders are read-only and single-select;
local folders provide the writable operations and selection behavior. Ordinary local folders open in
Folder View and have no editor switch. A recognized `.git` or `.mneme` folder opens Git Tree or
Mneme instead; use the Editor switch in that page's toolbar to open the folder's own contents in
Folder View and switch back. If a trusted board declares a matching `folderEditorMasks` claim, the
folder's Explorer row uses that board's icon and opens the board instead; use the page toolbar's
Editor switch to move between the board and Folder View. A published folder editor appears as **+**
in that switch until you install and register it through Board Info. See [Boards — Direct-folder
boards](../boards.md#direct-folder-boards).

## Layout

```
+---------------------------------------------------------------------+
| [Page nav] [Breadcrumb]                         [Switch]            |  toolbar: breadcrumb at left and switch at right
+---------------------------------------------------------------------+
| [Category tree] [folder items]                                      |  folder content below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Breadcrumb → `category-breadcrumb`
- Page navigation and Editor switch → no entry: shell-owned controls
- Category tree rows, file rows, and transient selection actions → no entry: repeated content

### When the category tree is visible

```
+---------------------------------------------------------------------+
| [Category tree] [folder items]                                      |  category and item regions in the folder body
+---------------------------------------------------------------------+
```

### When the category is empty or unavailable

```
+---------------------------------------------------------------------+
| [Empty or folder error message]                                     |  empty or error state in the folder body
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Tree rows, file rows, and context-menu actions — no entry: repeated content or transient actions; the breadcrumb is the stable facade control.

## Browsing and file operations

Each folder remembers its list or tile layout. Breadcrumb navigation and image thumbnails also work
for images inside archives, such as `document.docx!word/media`. In writable local folders, a row's
context menu keeps **Cut**, **Copy**, and **Paste** together, followed by the shared edit group
**Rename**, **Delete**, **New File**, **New Folder**. Paste and new-item actions target the row's
folder; for a file row, that is its parent folder.

### Selecting multiple items

In local File Explorer folders, use `Ctrl`/`Shift`-click or `Ctrl+A` to select multiple items.
`Delete` removes selected items after confirmation and `Escape` clears the selection. Copy, cut, and
delete operate on the selected set.

### Drag and drop

Drag files from Windows Explorer onto a folder row or empty folder space to copy them in. Drag a
selection out to Windows Explorer or another application. Archive folders remain single-select and
read-only.

## Agent API

After narrowing `page.editor.id` to `category-view`, the `FolderViewEditor` facade exposes folder
state. The verified element is `category-breadcrumb`; the file list and transient selection actions
are not in the current static facade inventory.

## Errors and limits

Permissions, missing paths, and archive read-only rules limit the available file operations. A folder
is not a general content page and should be opened through Explorer or the Archive panel.
