---
title: "Link Editor"
audience: both
summary: "Link collections with categories, tags, hostnames, views, previews, and drag-and-drop."
editorId: "link-view"
---

# Link Editor

Link Editor manages a `.link.json` collection with categories, tags, hostnames, previews, favicons,
and remembered list or tile views. A link can specify a target editor such as Browser, Image Viewer,
or Grid.

## How to Open

Open a `.link.json` file. JSON containing `"type": "link-editor"` and `"links"` can also expose the
Links switch. Agents can use `pages.addEditorPage("link-view", "json", title, content)`.

## Layout

## Collections and actions

Filter by collection, tag, or hostname from the corresponding sidebar panels. Switch between list
and tile views; view choices are remembered per collection, tag, or hostname. Preview images and
favicons enrich links when available. Reassign links between categories, import files or folders
from Explorer, drag between windows, and set the editor a link should open.

## Agent API

After narrowing `page.editor.id` to `link-view`, the `LinkEditor` facade exposes link, category, and
tag snapshots together with link mutations. It has no static UI elements inventory, so its API is
documented through collection state and mutation methods rather than invented addressable controls.
See [Links format](../formats/links.md) for the JSON shape.

## Errors and limits

The page must contain valid JSON in the Links format. An invalid `link-editor` document or missing
`links` collection cannot be detected as a Links page by content alone.
