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
