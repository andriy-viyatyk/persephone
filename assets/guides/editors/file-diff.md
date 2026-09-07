---
title: "Git Diff"
audience: both
summary: "Revision comparison for Git-tracked files with selectable From/To revisions and editable working tree."
editorId: "file-diff"
---

# Git Diff

Git Diff compares revisions of one Git-tracked file. It is a switchable editor, not a general
content-page target.

## How to Open

Enable Git Integration, open a tracked text file, and choose **Git Diff** in the page switch toolbar.
The default compares the latest commit with the current Unstaged working tree. Git Tree can also
open a selected change in this editor.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [From] [To] [Compare]             [Resources] [Switch]        |  toolbar: revision selectors and compare at left; resources and switch at right
+---------------------------------------------------------------------+
| [From revision]                         [To revision]               |  diff panes below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- From → `file-diff-picker-from`
- To → `file-diff-picker-to`
- Compare → `text-compare-left`
- Show Resources → `text-show-resources`
- Page navigation and Editor switch → no entry: shell-owned controls
- Revision tree rows → no entry: repeated revision content in the picker

### When the From or To revision picker is open

```
+---------------------------------------------------------------------+
| [Revision tree]                                                     |  revision picker popup beside the diff toolbar
+---------------------------------------------------------------------+
```

### When compare mode is available

```
+---------------------------------------------------------------------+
| [From revision] [To revision] [Compare]                             |  compare mode keeps the diff selectors and compare control at the left
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Revision tree rows — no entry: repeated popup content; the From and To picker buttons are addressable.
- Native file dialogs — no entry: OS-owned controls.
- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.

## Revisions and editing

Use **From** for the original side and **To** for the modified side. Choices include Unstaged,
Staged when available, and commits from the file history. The File History sidebar offers matching
L/R selections and a refresh action. When **To** is Unstaged, the right pane is editable and writes
to disk; all other revision pairs are read-only. Selected revisions persist with the tab.

## Agent API

After narrowing `page.editor.id` to `file-diff`, the facade exposes `from`, `to`, `hasStaged`, and
`readOnly`, which can be undefined while repository state loads. Verified elements include
`file-diff-picker-from`, `file-diff-picker-to`, `text-compare-left`, and `text-show-resources`.

## Errors and limits

Without a Git repository or an available Git executable, the editor shows an explanatory error and a
switch back to Text Editor; its switch option is hidden for unsupported files. Git Integration is off
by default. Only the Unstaged To revision is editable.
