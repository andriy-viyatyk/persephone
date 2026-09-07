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
local folders provide the writable operations and selection behavior.

## Layout

## Browsing and file operations

Each folder remembers its list or tile layout. Breadcrumb navigation and image thumbnails also work
for images inside archives, such as `document.docx!word/media`. In writable local folders, the context
menu offers open, rename, delete, copy path, **New File**, **New Folder**, and **Paste**.

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
