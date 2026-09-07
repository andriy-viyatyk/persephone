---
title: "Git Tree"
audience: both
summary: "Repository history and Git status with refs, changes, commits, panels, and navigation."
editorId: "git-tree"
---

# Git Tree

Git Tree is the repository history and status editor. It combines commit history, branches and tags,
working-tree changes, and Git actions in panels around the main view.

## How to Open

Enable **Git Integration** in [Settings](../screens/settings.md), then use the **Open Git Tree**
action on a repository's `.git` row in File Explorer. Clicking the row itself expands the folder;
the action opens Git Tree. Git integration is off by default.

## Layout

## History and changes

Inspect commits, branches, and tags; switch branches or commits; fetch, pull, and push; and stage,
unstage, reset, and commit files. The Changes tab separates Unstaged and Staged files and opens a
selected file in Git Diff. The commit panel shows commit metadata and an inline diff of changed files.
Multiple repositories can have independent Git panels. Refresh is automatic after repository changes.

## Agent API

After narrowing `page.editor.id` to `git-tree`, the `GitTreeEditor` facade exposes repository and
panel state. Verified elements include `git-tree-refresh`, `git-tree-bottom-tab-select`,
`git-tree-pull`, and `git-tree-push`. Git Diff and Git Integration details are in their corresponding
guides and [Settings](../screens/settings.md).

## Errors and limits

No Git features appear while Git Integration is disabled or Git is unavailable on PATH. A repository
must be open for history and working-tree operations; a failed pull or push leaves the repository
state for inspection and reports the Git error.
