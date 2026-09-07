---
title: "Archive Editor"
audience: both
summary: "Archive browser for compressed files, with tree navigation, inline previews, and extraction."
editorId: "archive-view"
---

# Archive Editor

Archive Editor browses compressed files, opens entries inline when possible, and extracts selected
content. It is a read/browse/extract experience, not an archive-writing editor.

## How to Open

Open an archive file; agents can use `app.pages.openFile(path)` for this specialized editor. The
archive tree appears in the sidebar and an entry opens in the main area.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Collapse all] [Refresh]                 [Switch]             |  archive toolbar: navigation and actions at left, switch at right
+---------------------------------------------------------------------+
| [Archive tree] [selected entry preview]                             |  archive content below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Collapse all → `archive-collapse-all`
- Refresh → `archive-refresh`
- Page navigation and Editor switch → no entry: shell-owned controls
- Archive tree rows → no entry: repeated archive content

### When an archive is loaded

```
+---------------------------------------------------------------------+
| [Archive tree] [selected entry preview]                             |  loaded archive content below the toolbar
+---------------------------------------------------------------------+
```

### When no archive is loaded

```
+---------------------------------------------------------------------+
| [No archive loaded]                                                 |  empty archive-editor state below the toolbar
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Archive tree rows — no entry: repeated content; the stable toolbar actions are addressable.

## Browse and extract

Tree navigation lists archive entries. Text entries open in Monaco and images in Image Viewer, so
documents such as `.docx` and `.xlsx` can be inspected without unpacking them. Refresh reloads the
listing and collapse-all closes expanded branches. Extracting an entry creates a regular file for
further editing.

Supported archive families include ZIP-based formats such as `.zip`, `.docx`, `.xlsx`, `.pptx`,
`.jar`, `.war`, `.epub`, `.odt`, `.ods`, and `.odp`, plus read-only handling for `.rar`, `.7z`,
`.tar*`, `.cab`, `.iso`, and `.asar`.

## Agent API

After narrowing `page.editor.id` to `archive-view`, the facade exposes archive state. Verified
elements are `archive-refresh` and `archive-collapse-all`.

## Errors and limits

Unsupported or corrupt archives may fail to list. The built-in editor does not write or edit archive
contents; extract an entry, edit the extracted file, and rebuild it with an external archive tool.
