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
`pages.addEditorPage("html-view", "html", title, content)`.

## Layout

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
