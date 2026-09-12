---
title: "HTML Preview"
audience: both
summary: "Sandboxed live HTML preview with JavaScript, resource extraction, and image capture."
editorId: "html-view"
---

# HTML Preview

HTML Preview runs a live, sandboxed rendering of an HTML document. It is useful for testing a page,
capturing its current appearance, and collecting the resources it references.

## How to Open

Open an `.html`, `.htm`, or `.xhtml` file and choose **Preview** in the page toolbar. The source
remains available in Text Editor; agents can create an HTML content page with
`pages.addEditorPage("html-view", "html", title, content)`. On a new or extensionless page, choose
**HTML** from the tab's language menu and then choose **Preview** in the toolbar.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Compare]             [Resources] [Copy] [More] [Switch]      |  toolbar: compare at left; resources, preview actions, and switch at right
+---------------------------------------------------------------------+
| [HTML preview]                                                      |  sandboxed HTML preview below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Show Resources → `text-show-resources`
- Copy → `html-copy`
- More → `html-more`
- Page navigation and Editor switch → no entry: shell-owned controls
- HTML preview content and its embedded controls → no entry: sandboxed preview content

### When the HTML image-actions popup is open

```
+---------------------------------------------------------------------+
| [Save as PNG] [Open in Image View] [Edit Image]                     |  transient HTML image-actions popup
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- HTML image-actions popup items — no entry: transient popup actions have no stable facade handles.
- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.

## Preview and capture

JavaScript runs inside the isolated preview and updates as the source changes. **Show Resources**
extracts images, scripts, stylesheets, media, fonts, iframes, favicons, and links into a categorized
link collection. Capture the rendered page at its current window size to **Copy**, **Save**, open in
Image Viewer, or open in Drawing Editor for annotation. Right-click can open the local file in the
Browser for interactive testing and DevTools.

## Agent API

After narrowing `page.editor.id` to `html-view`, the HTML facade exposes preview state. Verified
elements include `text-compare-left`, `text-show-resources`, `html-copy`, and `html-more`.

## Errors and limits

The capture reflects the current viewport, not an abstract full-page layout. Resource extraction and
scripts are limited by the preview's sandbox and the document's loading rules.
