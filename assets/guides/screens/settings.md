---
title: "Settings"
audience: both
summary: "Where Settings lives, how its sections work, and the settings that affect Persephone's screens and services."
screen: "settings"
editorId: "settings-view"
---

# Settings

Settings opens as an ordinary page from the Menu Bar gear icon, `[data-name="menubar-settings"]`.
The page has a fixed two-level **Content** tree on the left and a scrollable stack of outlined
panels on the right. Built-in sections appear in the General, Editors, Browser, and Integrations
groups. Trusted or bundled boards can add their own panel under Editors (when they are a custom
editor) or Boards.

When connected over MCP, read `settings.sections` for the built-in settings catalogue. Use
`settings.highlight(key)` to open or activate Settings and point at the containing section; `key`
is a settings key, not a DOM selector. Board-owned settings are read through the board bridge,
not through `app.settings`.

## Layout

```
+---------------------------------------------------------------------+
| [Content]                  | [Theme panel]                         |  fixed tree at left; panels scroll at right
|   General                   | [Window Behavior panel]               |  one outlined panel per section
|     Theme                   | [Editor Behavior panel]               |
|     Window Behavior         | [Browser Profiles panel]               |
|     Clipboard               | [Links panel]                          |
|     Terminal                | [MCP Server / Mneme panel]             |
|   Editors                   | ...                                     |
|     Editor Behavior         |                                         |
|     Script Library          |                                         |
|     Video Player            |                                         |
|     Excalidraw (when enabled)|                                        |
|   Browser                   |                                         |
|     Browser Profiles        |                                         |
|     Default Browser         |                                         |
|     Links                   |                                         |
|   Integrations              |                                         |
|     MCP Server / Mneme      | [View Settings File] in the left footer
|   Boards                    | board panels for standalone boards      |
+---------------------------------------------------------------------+
```

The Content tree always has exactly two levels: a group and its sections. Groups start expanded.
Click a group or section to scroll the panels to the corresponding content. Scrolling the panels
updates the selected section automatically, so the tree acts as a scroll-spy while you browse.

### User-facing label → `elements` name

- Settings root → no entry: region root; the content anchor is addressable
- Content tree → `settings-content-tree`
- Settings content → no entry: two-pane region containing the tree and panel scroll surface
- Theme → `theme`
- Window Behavior → `window.close-to-tray`
- Editor Behavior → `editor.word-wrap`
- Browser Profiles → `browser-profiles`, `browser-default-profile`, `browser-default-bookmarks-file`, `browser-incognito-bookmarks-file`, `tor.exe-path`, `tor.socks-port`, `tor.bookmarks-file`
- Links → `link-open-behavior`
- Default Browser → no entry: section has no catalog setting row
- File Search → `search-extensions`, `search-exclude`
- Clipboard → `clipboard.enabled`, `clipboard.max-items`
- MCP Server / Mneme → `mcp.enabled`, `mcp.port`, `main.scripting.enabled`, `mneme.enabled`, `mneme.port`
- Git Integration → `git.enabled`
- Board Environment Variables → `board-vars.file`
- Script Library → `script-library.path`
- Video Player → `vlc-path`, `video-stream.port`
- Terminal → `terminal.command`
- View Settings File → `settings-view-file`

### When Settings panels are expanded and visible

```
+---------------------------------------------------------------------+
| [Content tree]             | [section panel]                         |  tree remains fixed while panels scroll
|                            | [section panel]                         |
| [View Settings File]       | [section panel]                         |  action stays in the tree pane footer
+---------------------------------------------------------------------+
```

## Editor Behavior

The **Editor Behavior** section contains **Enable Word Wrap by default**, which is off by default.
It controls the initial wrapping state only when a newly shown Text Editor page has no saved page
state. Existing Text Editor pages keep their own persisted Word Wrap choice; use the Text Editor's
toolbar toggle to change one of those pages.

## Clipboard history

The **Clipboard** section contains an opt-in **Enable clipboard history** toggle and a **Maximum
history items** limit. History is off by default. When enabled, Persephone records supported copied
text, HTML, images, and file lists—including copies made in Persephone's Text Editor/Monaco and
Browser tabs—for the [Clipboard panel](./sidebar.md#clipboard), retaining between 1 and 1000 items
(100 by default). Capture depends on the copy reaching the Windows clipboard, not on which editor or
page supplied it. The section warns that occasionally-copied secrets may
remain on disk in readable form; disable the feature or clear its history when that matters.

### Drawn controls without `elements`

- Settings root, Content container, and section panels — no entry: structural regions; the Settings
  elements list exposes catalog keys and the page action.
- Section roots — no entry as separate Settings elements: generated key entries use each section
  root's selector and inherit its section phrase.

## Settings sections and stable targets

The page has a stable root, Content tree, panel scroll surface, and button for viewing the settings
file. Section names are containers for highlighting rather than individual setting controls.

| Section or control | Selector |
|---|---|
| Settings root | `[data-name="settings-root"]` |
| Settings content | `[data-name="settings-content"]` |
| Content tree | `[data-name="settings-content-tree"]` |
| Settings panels | `[data-name="settings-panels"]` |
| View Settings File | `[data-name="settings-view-file"]` |
| Theme | `[data-name="settings-section-theme"]` |
| Window Behavior | `[data-name="settings-section-window-behavior"]` |
| Editor Behavior | `[data-name="settings-section-editor"]` |
| Browser Profiles | `[data-name="settings-section-browser-profiles"]` |
| Links | `[data-name="settings-section-link-behavior"]` |
| Default Browser | `[data-name="settings-section-default-browser"]` |
| File Search | `[data-name="settings-section-file-search"]` |
| Clipboard | `[data-name="settings-section-clipboard"]` |
| MCP Server / Mneme | `[data-name="settings-section-mcp"]` |
| Git Integration | `[data-name="settings-section-git-integration"]` |
| Board Environment Variables | `[data-name="settings-section-board-vars"]` |
| Script Library | `[data-name="settings-section-script-library"]` |
| Video Player | `[data-name="settings-section-video-player"]` |
| Terminal | `[data-name="settings-section-terminal"]` |

Board panels use a generated selector based on the board's stable `author`/`name` identity. The
section selectors identify containing panels; read the live catalogue and board manifest for the
rows and labels instead of relying on a visual position that may change.

## Board settings

A trusted or bundled board can declare user-editable settings in its `board-manifest.json`. Its
settings appear as a board-named panel in Settings, with controls for the declared type and a
**Reset** action that returns the value to the manifest default. The panel is grouped under
**Editors** for boards that are custom editors and under **Boards** for other boards.

Persephone owns the values in `%APPDATA%\persephone\data\board-settings.json`; a board can only
read its own declared values through `persephone.settings.get(id)` and subscribe with
`persephone.settings.onChange(callback)`. The bridge exposes effective values, so a reset sends
the declaration's default. See [Boards](../boards.md#board-settings) for the manifest and bridge
example.

## Settings worth knowing about

| Key | Why it comes up |
|---|---|
| `mcp.enabled` | Off by default; enables the MCP server and starts it immediately when saved |
| `mcp.port` | Defaults to 7865; changing it requires disabling and re-enabling MCP to move a running server |
| `git.enabled` | Off by default; controls whether Git Tree and Git Diff features appear |
| `clipboard.enabled` | Off by default; records supported clipboard items for the Clipboard sidebar panel |
| `clipboard.max-items` | Defaults to 100; retains between 1 and 1000 clipboard history items |
| `mneme.enabled` | Off by default; enables the separate Mneme service, whose port is `mneme.port` |
| `theme` | Applies when saved; the settings file comments list the accepted theme names |
| `window.close-to-tray` | On by default; controls whether closing the last window hides to the tray or quits |
| `editor.word-wrap` | Off by default; selects the initial wrapping state for newly shown Text Editor pages, while existing pages keep their persisted choice |

Session restoration is not a Settings option. See [Page Tabs → Session restore](./tabs.md#session-restore)
for the fact that a valid saved session is always attempted and there is no setting to disable it.

## Connected MCP versus file editing

When connected over MCP, use the settings API. It applies and persists a change and triggers the
behavior associated with it:

```js
app.settings.set("theme", "monokai");
return { theme: app.settings.get("theme"), path: app.settings.settingsFilePath };
```

The `call` surface refuses changes to `mcp.enabled` and `mcp.port` because either can disconnect
the caller. Direct `app.settings.set` remains the normal script and UI path.

When not connected, edit `%APPDATA%\persephone\data\appSettings.json` to turn MCP on. The file is
JSON5, so comments and trailing commas are allowed. Persephone watches it and reloads changes
without a restart. It rewrites the file and its comments when a setting changes in the UI, so
change values rather than relying on added commentary. Deleting a key restores its default, and
deleting the whole file is safe because it is recreated.
