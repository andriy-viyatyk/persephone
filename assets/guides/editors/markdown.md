---
title: "Markdown Preview"
audience: both
summary: "GitHub-flavored Markdown preview with search, navigation, code blocks, Mermaid, and local assets."
editorId: "md-view"
---

# Markdown Preview

Markdown files open in a rendered Preview, with Text Editor available for source editing. The
renderer supports GitHub-flavored Markdown, task lists, syntax-highlighted fenced code, and inline
Mermaid diagrams.

## How to Open

Open `.md`, `.markdown`, `.mkd`, `.mdown`, `.mkdn`, `.mdwn`, or another recognized Markdown file.
Preview is the default; choose **Text Editor** in the toolbar to edit the source. A script-created
page can use `pages.addEditorPage("md-view", "markdown", title, content)`. On a new or extensionless
page, choose **Markdown** from the tab's language menu and then choose **Preview** in the toolbar.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Compare] [Back]                     [Compact] [Switch]       |  toolbar: shared actions at left, compact and switch at right
+---------------------------------------------------------------------+
| [Markdown preview] [scroll]                                         |  Markdown preview and scroll region below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Back → `markdown-back`
- Compact → `markdown-compact-toggle`
- Find field → `find-input`
- Previous → `find-prev`
- Next → `find-next`
- Close → `find-close`
- Editor switch and Page navigation → no entry: shell-owned controls
- Rendered document, code blocks, and minimap → no entry: generated document content

### When the Markdown find bar is open

```
+---------------------------------------------------------------------+
| [Find field] [Previous] [Next]                              [Close] |  Markdown find bar: search controls at left and close at right
+---------------------------------------------------------------------+
```

### When the Markdown minimap is visible

```
+---------------------------------------------------------------------+
| [Markdown preview]                              [Minimap]           |  preview region with the generated minimap at the right
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Rendered Markdown controls, code-block controls, and minimap — no entry: generated document content.

## Reading and navigation

Use `Ctrl+F`, `F3`, and `Shift+F3` to search. Code blocks have Monaco highlighting and copy buttons;
YAML front matter is shown as code. Relative images resolve from disk and their hover toolbar can
copy a PNG or open the Image Viewer. Links to local Markdown files navigate in the same tab with a
Back button, and stable anchor links work within and across documents. Azure DevOps wiki links and
`/.attachments/` images resolve against a repository root.

## Agent API

The Markdown facade exposes the preview state. Its verified elements include `text-compare-left`,
`markdown-compact-toggle`, `markdown-back`, `find-input`, `find-prev`, `find-next`, and `find-close`.
Use the page facade after narrowing `page.editor.id` to `md-view`; local guide links should use
relative `.md` paths so they work in both GitHub and the guide browser.

## Errors and limits

Preview is read-only for the rendered surface; edit source through Text Editor. A missing local
image or link remains a document/resource problem rather than a Markdown parse failure. Mermaid
blocks use the Mermaid viewer's rendering rules.
